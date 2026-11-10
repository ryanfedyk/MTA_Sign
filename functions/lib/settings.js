// Sign settings + one-off commands, stored in a single Firestore document
// (sign/config). The web app writes it; the sign reads a compact view of it
// every few seconds via /sign.

const ANIMATIONS = [
  { id: "walk", label: "Stroll" },
  { id: "chase", label: "Yarn chase" },
  { id: "peek", label: "Peek-a-boo" },
];
// "mix" = built-in cats + your animations marked for idle; "mine" = only yours
const IDLE_STYLES = [...ANIMATIONS.map((a) => a.id), "mix", "mine"];

const DEFAULTS = Object.freeze({
  // 8-bit panel brightness (was 16 / 6 originally); "night" applies from
  // nightStart to nightEnd (local hours, wrapping past midnight).
  brightness: { day: 12, night: 5, nightStart: 17, nightEnd: 7 },
  idle: { every: 30, style: "walk" },  // seconds between idle cats; 0 = off
  // Clock look (used by "clock" schedule blocks)
  clock: { font: "station", color: "#ffe1aa", color2: "#ff7d0f", effect: "solid",
           h24: false, ampm: false, date: true, blink: true, secBar: false },
  anim: null,                          // {seq, name, at}
  msg: null,                           // {seq, text, repeat, at}
  device: null,                        // {lastSeen}
});

const CLOCK_FONTS = ["station", "segment", "retro", "huge"];
const CLOCK_EFFECTS = ["solid", "gradient", "rainbow"];

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
    clock: { ...DEFAULTS.clock, ...(data.clock || {}) },
    anim: data.anim || null,
    msg: data.msg || null,
    device: data.device || null,
    lib: { v: (data.lib && data.lib.v) || 0 },
    schedule: { blocks: (data.schedule && Array.isArray(data.schedule.blocks)) ? data.schedule.blocks : null },
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
    for (const k of ["nightStart", "nightEnd"]) {
      if (body.brightness[k] !== undefined) {
        if (!Number.isFinite(Number(body.brightness[k]))) throw new Error(`brightness.${k} must be an hour`);
        patch.brightness[k] = clamp(body.brightness[k], [0, 23]);
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
  if (body.clock) {
    const c = body.clock, out = {};
    if (c.font !== undefined) { if (!CLOCK_FONTS.includes(c.font)) throw new Error("unknown clock font"); out.font = c.font; }
    if (c.effect !== undefined) { if (!CLOCK_EFFECTS.includes(c.effect)) throw new Error("unknown clock effect"); out.effect = c.effect; }
    for (const k of ["color", "color2"]) {
      if (c[k] !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(String(c[k]))) throw new Error(`clock.${k} must look like #rrggbb`);
        out[k] = String(c[k]).toLowerCase();
      }
    }
    for (const k of ["h24", "ampm", "date", "blink", "secBar"]) if (c[k] !== undefined) out[k] = Boolean(c[k]);
    patch.clock = out;
  }
  return patch;
}

/** The compact view the ESP32 polls (keep it tiny). */
function deviceView(cfg, nowMs = Date.now()) {
  const out = {
    bd: cfg.brightness.day,
    bn: cfg.brightness.night,
    ns: cfg.brightness.nightStart,   // night brightness from this hour...
    ne: cfg.brightness.nightEnd,     // ...until this hour (local time)
    ie: cfg.idle.every,
    is: cfg.idle.style,
    lv: cfg.lib.v % 1e9,
    ck: {
      f: cfg.clock.font, c: cfg.clock.color.slice(1), c2: cfg.clock.color2.slice(1), m: cfg.clock.effect,
      h24: cfg.clock.h24 ? 1 : 0, ap: cfg.clock.ampm ? 1 : 0, d: cfg.clock.date ? 1 : 0,
      b: cfg.clock.blink ? 1 : 0, sb: cfg.clock.secBar ? 1 : 0,
    },  // animation library version (fits 32 bits); the sign re-downloads /anims when it changes
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
    clock: cfg.clock,
    lastSeenSecondsAgo: cfg.device?.lastSeen ? Math.round((nowMs - cfg.device.lastSeen) / 1000) : null,
    firmware: cfg.device?.fw ?? null,
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
    async touchDevice(fw = null) {
      await ref.set({ device: { lastSeen: Date.now(), ...(fw !== null ? { fw } : {}) } }, { merge: true });
    },

    // ---- animation library (collection "animations") ----
    async listAnimations() {
      const snap = await getFirestore().collection("animations").orderBy("createdAt", "desc").limit(50).get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    },
    async addAnimation(a) {
      const doc = await getFirestore().collection("animations").add(toDoc(a));
      await bumpLib();
      return doc.id;
    },
    async updateAnimation(id, patch) {
      await getFirestore().collection("animations").doc(id).set(toDoc(patch), { merge: true });
      await bumpLib();
    },
    async deleteAnimation(id) {
      await getFirestore().collection("animations").doc(id).delete();
      await bumpLib();
    },
  };

  async function bumpLib() {
    await ref.set({ lib: { v: Date.now() } }, { merge: true });
  }
}

// Firestore can't store arrays of arrays (sprite frames), so the spec is kept as JSON text.
function toDoc(a) {
  const d = {};
  if (a.name !== undefined) d.name = a.name;
  if (a.prompt !== undefined) d.prompt = a.prompt;
  if (a.inIdle !== undefined) d.inIdle = Boolean(a.inIdle);
  if (a.spec !== undefined) d.specJson = JSON.stringify(a.spec);
  if (a.createdAt !== undefined) d.createdAt = a.createdAt;
  return d;
}
function fromDoc(id, d) {
  return { id, name: d.name, prompt: d.prompt || "", inIdle: Boolean(d.inIdle), createdAt: d.createdAt || 0,
    spec: d.specJson ? JSON.parse(d.specJson) : null };
}

function memoryStore(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  const anims = {};
  let nextId = 0;
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
    async touchDevice(fw = null) { merge(data, { device: { lastSeen: Date.now(), ...(fw !== null ? { fw } : {}) } }); },
    async listAnimations() {
      return Object.entries(anims).map(([id, d]) => fromDoc(id, d)).sort((a, b) => b.createdAt - a.createdAt);
    },
    async addAnimation(a) {
      const id = "anim" + ++nextId;
      anims[id] = toDoc(a);
      merge(data, { lib: { v: (data.lib?.v || 0) + 1 } });
      return id;
    },
    async updateAnimation(id, patch) {
      anims[id] = { ...(anims[id] || {}), ...toDoc(patch) };
      merge(data, { lib: { v: (data.lib?.v || 0) + 1 } });
    },
    async deleteAnimation(id) {
      delete anims[id];
      merge(data, { lib: { v: (data.lib?.v || 0) + 1 } });
    },
    _data: () => data,
  };
}

module.exports = {
  ANIMATIONS, IDLE_STYLES, DEFAULTS, LIMITS, CLOCK_FONTS, CLOCK_EFFECTS,
  withDefaults, cleanMessage, validatePatch, deviceView, appView,
  firestoreStore, memoryStore,
};
