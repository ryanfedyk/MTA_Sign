// Cloud functions for the MTA sign.
//
//   /transit  arrivals for the ESP32 (polled every 30 s)
//   /sign     brightness, idle-cat settings, and pending animation/message
//             commands for the ESP32 (polled every 5 s)
//   /anims    your saved animations in the compact format the ESP32 plays
//             (re-downloaded whenever the library version in /sign changes)
//   /app      the phone-friendly control panel, plus its small JSON API
//
// Secrets never live in this repo (it's public). At deploy time GitHub Actions
// writes them into functions/.env from repository secrets, and Firebase loads
// that file into process.env:
//   MTA_BUS_KEY   MTA Bus Time API key
//   SIGN_APP_PIN  passphrase for the control panel
//   GEMINI_API_KEY  Google AI Studio key for generating animations (optional)
//   GEMINI_MODEL    override the Gemini model (optional, default gemini-3.8-flash)
//   MTA_API_KEY     sent as x-api-key to the MTA service-alert feeds, if they require one (optional)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");

const schedule = require("./lib/schedule");
const { planFor } = schedule;
const { buildArrivals } = require("./lib/transit");
const { currentAlerts } = require("./lib/alerts");
const settings = require("./lib/settings");
const animations = require("./lib/animations");

const HTTP_OPTS = { cors: true, memory: "256MiB", timeoutSeconds: 15 };

const { getStore } = require("./lib/store");

// The schedule changes rarely, so each server instance keeps it for 30 s.
let cachedBlocks = null, cachedAt = 0;
async function scheduleBlocks() {
  if (Date.now() - cachedAt < 30000) return cachedBlocks;
  try {
    cachedBlocks = (await getStore().get()).schedule.blocks;   // null = original rules
  } catch (e) {
    console.error("schedule unavailable, using defaults:", e.message);
  }
  cachedAt = Date.now();
  return cachedBlocks;
}

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

    const blocks = await scheduleBlocks();
    const alerts = await currentAlerts();
    const plan = planFor(now, { busDir: req.query.dir }, blocks, alerts);
    plan.alerts = alerts;
    const debug = req.query.debug === "1" ? true : req.query.debug === "raw" ? "raw" : false;
    const body = await buildArrivals(plan, { busKey, debug });
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
    const fw = Number.parseInt(req.query.fw, 10);
    getStore().touchDevice(Number.isFinite(fw) ? fw : null).catch((e) => console.error("touchDevice:", e.message));
  }
  res.set("Cache-Control", "no-store");
  res.json(settings.deviceView(cfg));
});

// ---------------------------------------------------------------------------
// /anims  (ESP32 animation library)
// ---------------------------------------------------------------------------
async function deviceLibrary() {
  const s = getStore();
  const [cfg, list] = await Promise.all([s.get(), s.listAnimations()]);
  const out = [];
  let bytes = 0;
  for (const a of list.slice(0, animations.LIMITS.maxLibrary)) {
    if (!a.spec) continue;
    const dev = animations.toDevice(a.spec, a.id, { idle: a.inIdle });
    const size = JSON.stringify(dev).length;
    if (bytes + size > animations.LIMITS.maxDeviceBytes) continue;   // keep the sign's download small
    bytes += size;
    out.push(dev);
  }
  return { v: cfg.lib.v % 1e9, a: out };
}

exports.anims = onRequest(HTTP_OPTS, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json(await deviceLibrary());
  } catch (err) {
    console.error("anims:", err.message);
    res.json({ v: 0, a: [] });
  }
});

// ---------------------------------------------------------------------------
// /app  (control panel)
// ---------------------------------------------------------------------------
// The sign's own pixel fonts are embedded so app previews match the panel exactly.
const APP_HTML = fs.readFileSync(path.join(__dirname, "lib", "webapp.html"), "utf8")
  .replace("/*SIGN_FONTS*/null", fs.readFileSync(path.join(__dirname, "lib", "signfonts.json"), "utf8").trim());

function pinOk(given) {
  const expected = process.env.SIGN_APP_PIN;
  if (!expected || !given) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini can take a while to draw, so the app gets a longer timeout.
exports.app = onRequest({ ...HTTP_OPTS, memory: "512MiB", timeoutSeconds: 300 }, async (req, res) => {
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
      const name = String(body.name || "");
      const builtin = settings.ANIMATIONS.some((a) => a.id === name);
      const cloud = name.startsWith("c:") && (await s.listAnimations()).some((a) => "c:" + a.id === name);
      if (!builtin && !cloud) return res.status(400).json({ error: "Unknown animation" });
      const entry = await s.command("anim", { name });
      return res.json({ ok: true, seq: entry.seq });
    }

    // ---- your animations ----
    if (req.method === "GET" && route === "/api/animations") {
      const list = await s.listAnimations();
      return res.json({ animations: list, geminiReady: Boolean(process.env.GEMINI_API_KEY) });
    }
    if (req.method === "POST" && route === "/api/animations/generate") {
      let spec;
      try {
        spec = await animations.generateAnimation(body.prompt, {
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || undefined,
        });
      } catch (e) {
        console.error("generate:", e.message);
        return res.status(e.status === 429 ? 429 : 422).json({ error: e.message });
      }
      const prompt = String(body.prompt).trim().slice(0, animations.LIMITS.maxPromptLength);
      const id = await s.addAnimation({ name: spec.name, prompt, spec, inIdle: false, createdAt: Date.now() });
      return res.json({ ok: true, animation: { id, name: spec.name, prompt, spec, inIdle: false } });
    }
    // ---- schedule ----
    if (route === "/api/schedule" && (req.method === "GET" || req.method === "POST")) {
      if (req.method === "POST") {
        let blocks = null;   // null = back to the original rules
        if (!body.reset) {
          try { blocks = schedule.validateBlocks(body.blocks); } catch (e) { return res.status(400).json({ error: e.message }); }
        }
        await s.update({ schedule: { blocks } });
        cachedAt = 0;
      }
      const blocks = (await s.get()).schedule.blocks;
      const now = planFor(new Date(), {}, blocks);
      return res.json({
        blocks: blocks || schedule.DEFAULT_BLOCKS,
        isDefault: !blocks,
        defaults: schedule.DEFAULT_BLOCKS,
        now: schedule.describePlan(now),
      });
    }
    if (req.method === "GET" && route === "/api/assets") {
      const { ASSETS, ASSET_PALETTE } = require("./lib/assets");
      return res.json({ palette: ASSET_PALETTE, assets: ASSETS });
    }
    // Save an animation made without AI (Quick animation builder, uploaded image).
    if (req.method === "POST" && route === "/api/animations/create") {
      let spec;
      try { spec = animations.normalizeSpec(body.spec); } catch (e) { return res.status(400).json({ error: e.message }); }
      if (body.name) spec.name = String(body.name).replace(/[^\x20-\x7E]/g, "").trim().slice(0, 40) || spec.name;
      const prompt = String(body.source || "").slice(0, 100);
      const id = await s.addAnimation({ name: spec.name, prompt, spec, inIdle: false, createdAt: Date.now() });
      return res.json({ ok: true, animation: { id, name: spec.name, prompt, spec, inIdle: false } });
    }
    if (req.method === "POST" && route === "/api/animations/update") {
      if (!body.id) return res.status(400).json({ error: "Missing id" });
      const patch = {};
      if (body.inIdle !== undefined) patch.inIdle = Boolean(body.inIdle);
      if (body.name !== undefined) patch.name = String(body.name).replace(/[^\x20-\x7E]/g, "").trim().slice(0, 40);
      if (body.spec !== undefined) {
        try { patch.spec = animations.normalizeSpec(body.spec); } catch (e) { return res.status(400).json({ error: e.message }); }
      }
      await s.updateAnimation(String(body.id), patch);
      return res.json({ ok: true });
    }
    if (req.method === "POST" && route === "/api/animations/delete") {
      if (!body.id) return res.status(400).json({ error: "Missing id" });
      await s.deleteAnimation(String(body.id));
      return res.json({ ok: true });
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
