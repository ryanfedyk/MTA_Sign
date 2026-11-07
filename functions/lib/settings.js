// Sign settings + one-off commands, stored in a single Firestore document
// (sign/config). The web app writes it; the sign reads a compact view of it
// every few seconds via /sign.

const ANIMATIONS = [
  { id: "walk", label: "Stroll" },
  { id: "chase", label: "Yarn chase" },
  { id: "peek", label: "Peek-a-boo" },
];
const IDLE_STYLES = [...ANIMATIONS.map((a) => a.id), "mix"];

const DEFAULTS = Object.freeze({
  brightness: { day: 12, night: 5 },   // 8-bit panel brightness (was 16 / 6 originally)
  idle: { every: 30, style: "walk" },  // seconds between idle cats; 0 = off
  anim: null,                          // {seq, name, at}
  msg: null,                           // {seq, text, repeat, at}
  device: null,                        // {lastSeen}
});

const LIMITS = { brightness: [1, 64], idleEvery: [0, 3600], msgLength: 80, repeat: [1, 5] };

// A command stays "fresh" this long, so a sign that briefly lost Wi-Fi still
// gets it, but an old message never replays after a reboot.
const ANIM_FRESH_MS = 60 * 1000;
const MSG_FRESH_MS = 5 * 60 * 1000;

const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(n))));

function withDefaults(data = {}) {
  return {
    brightness: { ...DEFAULTS.brightness, ...(data.brightness || {}) },
    idle: { ...DEFAULTS.idle, ...(data.idle || {}) },
    anim: data.anim || null,
    msg: data.msg || null,
    device: data.device || null,
  };
}

/** Keep messages to characters the LED font can draw. */
function cleanMessage(text) {
  return String(text ?? "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.msgLength);
}

/** Validate a settings patch from the web app. Throws on bad input. */
function validatePatch(body = {}) {
  const patch = {};
  if (body.brightness) {
    patch.brightness = {};
    for (const k of ["day", "night"]) {
      if (body.brightness[k] !== undefined) {
        if (!Number.isFinite(Number(body.brightness[k]))) throw new Error(`brightness.${k} must be a number`);
        patch.brightness[k] = clamp(body.brightness[k], LIMITS.brightness);
      }
    }
  }
  if (body.idle) {
    patch.idle = {};
    if (body.idle.every !== undefined) {
      if (!Number.isFinite(Number(body.idle.every))) throw new Error("idle.every must be a number");
      patch.idle.every = clamp(body.idle.every, LIMITS.idleEvery);
    }
    if (body.idle.style !== undefined) {
      if (!IDLE_STYLES.includes(body.idle.style)) throw new Error("unknown idle style");
      patch.idle.style = body.idle.style;
    }
  }
  return patch;
}

/** The compact view the ESP32 polls (keep it tiny). */
function deviceView(cfg, nowMs = Date.now()) {
  const out = {
    bd: cfg.brightness.day,
    bn: cfg.brightness.night,
    ie: cfg.idle.every,
    is: cfg.idle.style,
  };
  if (cfg.anim && nowMs - cfg.anim.at < ANIM_FRESH_MS) out.a = { i: cfg.anim.seq, n: cfg.anim.name };
  if (cfg.msg && nowMs - cfg.msg.at < MSG_FRESH_MS) out.m = { i: cfg.msg.seq, t: cfg.msg.text, r: cfg.msg.repeat };
  return out;
}

/** What the web app sees. */
function appView(cfg, nowMs = Date.now()) {
  return {
    brightness: cfg.brightness,
    idle: cfg.idle,
    lastSeenSecondsAgo: cfg.device?.lastSeen ? Math.round((nowMs - cfg.device.lastSeen) / 1000) : null,
    animations: ANIMATIONS,
    idleStyles: IDLE_STYLES,
    limits: LIMITS,
  };
}

// ---------------------------------------------------------------------------
// Firestore-backed store (swapped for an in-memory one in tests)
// ---------------------------------------------------------------------------
function firestoreStore() {
  const { initializeApp, getApps } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  if (!getApps().length) initializeApp();
  const ref = getFirestore().doc("sign/config");

  return {
    async get() {
      const snap = await ref.get();
      return withDefaults(snap.exists ? snap.data() : {});
    },
    async update(patch) {
      await ref.set(patch, { merge: true });
    },
    // Records a one-off command ("anim" or "msg") with an increasing sequence
    // number so the sign can tell a new request from one it already played.
    async command(kind, payload) {
      return getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data()[kind] : null;
        const entry = { ...payload, seq: ((prev && prev.seq) || 0) + 1, at: Date.now() };
        tx.set(ref, { [kind]: entry }, { merge: true });
        return entry;
      });
    },
    async touchDevice() {
      await ref.set({ device: { lastSeen: Date.now() } }, { merge: true });
    },
  };
}

function memoryStore(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) {
      a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] && typeof a[k] === "object" ? a[k] : {}, v) : v;
    }
    return a;
  };
  return {
    async get() { return withDefaults(JSON.parse(JSON.stringify(data))); },
    async update(patch) { merge(data, patch); },
    async command(kind, payload) {
      const entry = { ...payload, seq: ((data[kind] && data[kind].seq) || 0) + 1, at: Date.now() };
      data[kind] = entry;
      return entry;
    },
    async touchDevice() { merge(data, { device: { lastSeen: Date.now() } }); },
    _data: () => data,
  };
}

module.exports = {
  ANIMATIONS, IDLE_STYLES, DEFAULTS, LIMITS,
  withDefaults, cleanMessage, validatePatch, deviceView, appView,
  firestoreStore, memoryStore,
};
