// Cloud functions for the MTA sign.
//
//   /transit  arrivals for the ESP32 (polled every 30 s)
//   /sign     brightness, idle-cat settings, and pending animation/message
//             commands for the ESP32 (polled every 5 s)
//   /app      the phone-friendly control panel, plus its small JSON API
//
// Secrets never live in this repo (it's public). At deploy time GitHub Actions
// writes them into functions/.env from repository secrets, and Firebase loads
// that file into process.env:
//   MTA_BUS_KEY   MTA Bus Time API key
//   SIGN_APP_PIN  passphrase for the control panel

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");

const { planFor } = require("./lib/schedule");
const { buildArrivals } = require("./lib/transit");
const settings = require("./lib/settings");

const HTTP_OPTS = { cors: true, memory: "256MiB", timeoutSeconds: 15 };

const { getStore } = require("./lib/store");

// ---------------------------------------------------------------------------
// /transit
// ---------------------------------------------------------------------------
exports.transit = onRequest(HTTP_OPTS, async (req, res) => {
  try {
    const busKey = process.env.MTA_BUS_KEY;
    if (!busKey) console.error("MTA_BUS_KEY is not configured; B48 data unavailable");

    // ?at=2026-11-08T10:00:00-05:00 previews the schedule at another time (testing)
    const now = req.query.at ? new Date(String(req.query.at)) : new Date();
    if (Number.isNaN(now.getTime())) return res.status(400).json({ error: "bad ?at= time" });

    const plan = planFor(now, { busDir: req.query.dir });
    const body = await buildArrivals(plan, { busKey, debug: req.query.debug === "1" });
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// /sign  (ESP32 settings + commands)
// ---------------------------------------------------------------------------
let lastTouch = 0;
exports.sign = onRequest(HTTP_OPTS, async (req, res) => {
  let cfg;
  try {
    cfg = await getStore().get();
  } catch (err) {
    console.error("settings unavailable, using defaults:", err.message);
    cfg = settings.withDefaults();
  }
  // Remember when the sign last checked in (at most once a minute).
  if (Date.now() - lastTouch > 60000) {
    lastTouch = Date.now();
    getStore().touchDevice().catch((e) => console.error("touchDevice:", e.message));
  }
  res.set("Cache-Control", "no-store");
  res.json(settings.deviceView(cfg));
});

// ---------------------------------------------------------------------------
// /app  (control panel)
// ---------------------------------------------------------------------------
const APP_HTML = fs.readFileSync(path.join(__dirname, "lib", "webapp.html"), "utf8");

function pinOk(given) {
  const expected = process.env.SIGN_APP_PIN;
  if (!expected || !given) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.app = onRequest(HTTP_OPTS, async (req, res) => {
  const route = new URL(req.url, "http://localhost").pathname.replace(/\/+$/, "") || "/";
  res.set("Cache-Control", "no-store");

  if (req.method === "GET" && !route.startsWith("/api")) {
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(APP_HTML);
  }

  if (!process.env.SIGN_APP_PIN) {
    return res.status(503).json({ error: "The control panel passphrase (SIGN_APP_PIN) hasn't been set up yet." });
  }
  if (!pinOk(req.get ? req.get("x-sign-pin") : req.headers["x-sign-pin"])) {
    await sleep(800); // slow down guessing
    return res.status(401).json({ error: "Wrong passphrase" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const s = getStore();
    if (req.method === "GET" && route === "/api/settings") {
      return res.json(settings.appView(await s.get()));
    }
    if (req.method === "POST" && route === "/api/settings") {
      let patch;
      try { patch = settings.validatePatch(body); } catch (e) { return res.status(400).json({ error: e.message }); }
      await s.update(patch);
      return res.json(settings.appView(await s.get()));
    }
    if (req.method === "POST" && route === "/api/play") {
      if (!settings.ANIMATIONS.some((a) => a.id === body.name)) return res.status(400).json({ error: "Unknown animation" });
      const entry = await s.command("anim", { name: body.name });
      return res.json({ ok: true, seq: entry.seq });
    }
    if (req.method === "POST" && route === "/api/message") {
      const text = settings.cleanMessage(body.text);
      if (!text) return res.status(400).json({ error: "Type a message first" });
      const repeat = Math.min(settings.LIMITS.repeat[1], Math.max(settings.LIMITS.repeat[0], Number(body.repeat) || 2));
      const entry = await s.command("msg", { text, repeat });
      return res.json({ ok: true, seq: entry.seq, text });
    }
    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error("app api:", err);
    return res.status(503).json({ error: "Couldn't reach the settings database.", detail: err.message });
  }
});
