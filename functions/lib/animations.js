// Cloud animations: a small, LED-friendly animation format that Gemini can
// write and the ESP32 can play without re-flashing.
//
// Spec (what Gemini returns, what the web app previews):
// {
//   name: "Cat chases a butterfly",
//   duration_ms: 5000,
//   background: "transit" | "black",    // draw over the arrival times, or a full-screen scene
//   palette: { "o": "#ff7d0f", "w": "#ffe1af", ... },   // '.' is always transparent
//   sprites: [ { name, frame_ms, frames: [ ["..oo..", ...rows], ...more frames ] } ],
//   actors:  [ { sprite: 0, outline: true,
//                keyframes: [ { t: 0, x: -16, y: 21, flip: false }, { t: 4000, x: 64, y: 21 } ] } ]
// }
// Actors move in straight lines between keyframes (x, y = sprite's top-left
// corner) and are hidden before their first / after their last keyframe.

const { ASSETS, ASSET_PALETTE, catalogText } = require("./assets");

const IMAGE_W = 64, IMAGE_H = 32;   // optional full-screen image layer (RGB332, 1 byte/pixel)

const LIMITS = {
  maxW: 48, maxH: 32, maxFrames: 8, maxSprites: 16, maxActors: 48, maxKeys: 32,
  maxColors: 15, minDuration: 1000, maxDuration: 15000, maxPromptLength: 400,
  maxLibrary: 12, maxDeviceBytes: 20000,
};

const CODES = "0123456789abcde";   // palette index characters in the device format

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function parseColor(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (m) return m[1].toLowerCase();
  const s = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(String(c || "").trim());
  if (s) return (s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  return null;
}

/**
 * Replace {"asset": "cat_walk"} sprites with the library's frames, merging the
 * library colors into the spec's palette (re-lettering on conflicts).
 */
function expandAssets(raw) {
  if (!raw || !Array.isArray(raw.sprites) || !raw.sprites.some((sp) => sp && sp.asset)) return raw;
  const palette = { ...(raw.palette || {}) };
  const byHex = {};
  for (const [k, v] of Object.entries(palette)) { const h = parseColor(v); if (h) byHex[h] = k; }
  const spare = [..."ACDEFGHIJKLMNOPQSTUVXYZ123456789"].filter((c) => !(c in palette) && !(c in ASSET_PALETTE));

  const charFor = (assetChar) => {
    const hex = ASSET_PALETTE[assetChar].slice(1);
    if (byHex[hex]) return byHex[hex];
    let c = assetChar in palette ? spare.shift() : assetChar;
    if (!c) return null;
    palette[c] = "#" + hex;
    byHex[hex] = c;
    return c;
  };

  const sprites = raw.sprites.map((sp) => {
    if (!sp || !sp.asset) return sp;
    const a = ASSETS[sp.asset];
    if (!a) throw new Error(`unknown asset "${sp.asset}" (available: ${Object.keys(ASSETS).join(", ")})`);
    const map = {};
    const frames = a.frames.map((f) => f.map((row) => [...row].map((ch) => {
      if (ch === ".") return ".";
      if (!(ch in map)) map[ch] = charFor(ch);
      return map[ch] || ".";
    }).join("")));
    return { name: sp.name || a.label, frame_ms: sp.frame_ms ?? a.frame_ms, frames };
  });
  return { ...raw, palette, sprites };
}

function normalizeImage(img) {
  if (!img) return null;
  const b64 = typeof img === "string" ? img : img.rgb332;
  const bytes = Buffer.from(String(b64 || ""), "base64");
  if (bytes.length !== IMAGE_W * IMAGE_H) throw new Error(`image must be ${IMAGE_W}x${IMAGE_H} RGB332 (got ${bytes.length} bytes)`);
  return { rgb332: bytes.toString("base64") };
}

/**
 * Validate and repair a spec (from Gemini or the app). Returns a clean spec or
 * throws an Error whose message explains what's wrong (fed back to Gemini).
 */
function normalizeSpec(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Animation must be a JSON object");
  raw = expandAssets(raw);
  const image = normalizeImage(raw.image);
  const duration = clampInt(raw.duration_ms ?? raw.duration, LIMITS.minDuration, LIMITS.maxDuration, 5000);
  const background = raw.background === "black" ? "black" : "transit";
  const name = String(raw.name || "Untitled").replace(/[^\x20-\x7E]/g, "").trim().slice(0, 40) || "Untitled";

  // Palette
  const palette = {};
  for (const [k, v] of Object.entries(raw.palette || {})) {
    if (typeof k !== "string" || k.length !== 1 || k === "." || k === " ") continue;
    const hex = parseColor(v);
    if (!hex) continue;
    if (Object.keys(palette).length >= LIMITS.maxColors) break;
    palette[k] = "#" + hex;
  }
  const imageOnly = image && (!Array.isArray(raw.sprites) || !raw.sprites.length);
  if (imageOnly) {
    return { name, duration_ms: duration, background: "black", palette: {}, sprites: [], actors: [], image };
  }
  if (!Object.keys(palette).length) throw new Error("palette has no valid colors (use single-character keys and #RRGGBB values)");

  // Sprites
  if (!Array.isArray(raw.sprites) || !raw.sprites.length) throw new Error("sprites must be a non-empty array");
  const sprites = raw.sprites.slice(0, LIMITS.maxSprites).map((sp, i) => {
    let frames = Array.isArray(sp?.frames) ? sp.frames : [];
    // Accept a single frame given as a flat list of rows
    if (frames.length && typeof frames[0] === "string") frames = [frames];
    frames = frames.filter((f) => Array.isArray(f) && f.length).slice(0, LIMITS.maxFrames);
    if (!frames.length) throw new Error(`sprite ${i} has no frames`);
    const h = Math.min(LIMITS.maxH, Math.max(...frames.map((f) => f.length)));
    const w = Math.min(LIMITS.maxW, Math.max(...frames.flat().map((r) => String(r).length)));
    if (w < 1 || h < 1) throw new Error(`sprite ${i} is empty`);
    const clean = frames.map((f) => {
      const rows = [];
      for (let r = 0; r < h; r++) {
        const row = String(f[r] ?? "").slice(0, w).padEnd(w, ".");
        rows.push([...row].map((ch) => (palette[ch] ? ch : ".")).join(""));
      }
      return rows;
    });
    if (clean.every((f) => f.every((row) => /^\.*$/.test(row)))) throw new Error(`sprite ${i} only uses colors missing from the palette`);
    return {
      name: String(sp.name || `sprite ${i}`).slice(0, 30),
      frame_ms: clampInt(sp.frame_ms ?? sp.frameMs, 40, 2000, 150),
      frames: clean,
    };
  });

  // Actors
  if (!Array.isArray(raw.actors) || !raw.actors.length) throw new Error("actors must be a non-empty array");
  const actors = raw.actors.slice(0, LIMITS.maxActors).map((a, i) => {
    const sprite = clampInt(a?.sprite, 0, sprites.length - 1, 0);
    const keys = (Array.isArray(a?.keyframes) ? a.keyframes : [])
      .map((k) => ({
        t: clampInt(k?.t, 0, duration, 0),
        x: clampInt(k?.x, -128, 191, 0),
        y: clampInt(k?.y, -40, 71, 0),
        flip: Boolean(k?.flip),
      }))
      .sort((p, q) => p.t - q.t)
      .slice(0, LIMITS.maxKeys);
    if (!keys.length) throw new Error(`actor ${i} has no keyframes`);
    const phase = clampInt(a.phase, 0, 60000, 0);
    let sway = null;
    if (a.sway && typeof a.sway === "object") {
      const sx = clampInt(a.sway.x, -30, 30, 0), sy = clampInt(a.sway.y, -30, 30, 0), sms = clampInt(a.sway.ms, 200, 20000, 1000);
      if (sx || sy) sway = { x: sx, y: sy, ms: sms };
    }
    return { sprite, outline: a.outline !== false, keyframes: keys, ...(phase ? { phase } : {}), ...(sway ? { sway } : {}) };
  });

  return { name, duration_ms: duration, background: image ? "black" : background, palette, sprites, actors, ...(image ? { image } : {}) };
}

/** Compact form for the ESP32 (palette as an array, sprites as index strings). */
function toDevice(spec, id, { idle = false } = {}) {
  const chars = Object.keys(spec.palette);
  const code = Object.fromEntries(chars.map((c, i) => [c, CODES[i]]));
  return {
    id,
    d: spec.duration_ms,
    bg: spec.background === "black" ? 1 : 0,
    i: idle ? 1 : 0,
    p: chars.map((c) => spec.palette[c].slice(1)),
    s: spec.sprites.map((sp) => ({
      w: sp.frames[0][0].length,
      h: sp.frames[0].length,
      f: sp.frame_ms,
      fr: sp.frames.map((rows) => rows.map((row) => [...row].map((ch) => (ch === "." ? "." : code[ch])).join("")).join("")),
    })),
    a: spec.actors.map((a) => ({ s: a.sprite, o: a.outline ? 1 : 0, ...(a.phase ? { p: a.phase } : {}), ...(a.sway ? { w: [a.sway.x, a.sway.y, a.sway.ms] } : {}), k: a.keyframes.map((k) => [k.t, k.x, k.y, k.flip ? 1 : 0]) })),
    ...(spec.image ? { img: spec.image.rgb332 } : {}),
  };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
// Example answer shown to Gemini: library sprites, a little story, secondary motion.
const EXAMPLE = {
  name: "Cat chases a laser dot",
  duration_ms: 6500,
  background: "transit",
  palette: {},
  sprites: [
    { asset: "laser" },
    { asset: "cat_run" },
    { asset: "cat_sit" },
    { asset: "heart" },
  ],
  actors: [
    { sprite: 0, outline: false, keyframes: [
      { t: 0, x: 70, y: 27 }, { t: 600, x: 40, y: 28 }, { t: 1500, x: 8, y: 26 },
      { t: 2300, x: 50, y: 27 }, { t: 3200, x: 66, y: 27 } ] },
    { sprite: 1, outline: true, keyframes: [
      { t: 700, x: 66, y: 21, flip: true }, { t: 1200, x: 36, y: 19, flip: true }, { t: 1700, x: 6, y: 21, flip: true },
      { t: 1701, x: 6, y: 21, flip: false }, { t: 2500, x: 36, y: 19, flip: false }, { t: 3300, x: 50, y: 21, flip: false } ] },
    { sprite: 2, outline: true, keyframes: [ { t: 3301, x: 50, y: 20, flip: true }, { t: 6500, x: 50, y: 20, flip: true } ] },
    { sprite: 3, outline: true, phase: 150, keyframes: [ { t: 4000, x: 53, y: 14 }, { t: 5400, x: 55, y: 4 } ] },
    { sprite: 3, outline: true, keyframes: [ { t: 4600, x: 47, y: 13 }, { t: 6000, x: 45, y: 3 } ] },
  ],
};

const SYSTEM_PROMPT = `You are a pixel-art animator for a 64x32 RGB LED matrix sign that hangs in a home and shows subway arrival times.
You turn a short request into a charming little animation and reply with ONLY a JSON object (no prose, no code fences).

Canvas: x 0..63 left to right, y 0..31 top to bottom. Each pixel is one LED, so everything must read at tiny size.

JSON format:
{
  "name": short title (max 40 chars),
  "duration_ms": total length, 3000-12000,
  "background": "transit" (drawn on top of the live arrival times, like a character passing in front of the sign) or "black" (a full-screen scene),
  "palette": { single-character key: "#RRGGBB" } for sprites you draw yourself (library sprites bring their own colors); "." is transparent and never in the palette,
  "sprites": [ { "asset": "<library name>" } or { "name": text, "frame_ms": 60-400, "frames": [ [row strings...], ...1-8 frames ] } ],
  "actors": [ { "sprite": index into sprites, "outline": true/false, "phase": optional ms offset for its frame cycle and sway,
                "sway": optional built-in wobble on top of the path { "x": px, "y": px, "ms": one cycle },
                "keyframes": [ { "t": ms, "x": int, "y": int, "flip": bool }, ... ] } ]
}

THE SPRITE LIBRARY (use it! these are hand-drawn and look far better than anything drawn from scratch). All face right; "flip": true faces left.
${catalogText()}

Rules:
- Use library sprites for every character and object they cover. Only draw a new sprite for something the library lacks: keep it small (at most 16x16), bold, 2-4 colors, every row of every frame the same length.
- x, y is the sprite's top-left corner. Actors move in a straight line between keyframes and are hidden before their first and after their last keyframe. Enter and exit off-screen (x = -width or x = 64).
- At most 40 actors, 32 keyframes each, 12 sprites, 15 colors in total.
- "outline": true adds a 1 px dark halo so a character stays readable over the arrival-time text; use it for characters on "transit". Use false for tiny particles (snow, leaves, sparkles) and for scenery.

Make it feel hand-animated (this matters most):
- Tell a tiny story in 5-10 s: an entrance, something happening, an ending (an exit or a final pose).
- Several actors: characters plus secondary motion (falling leaves or snow, sparkles, hearts, zzz, birds). A scene with one actor is too plain.
- Natural motion: several keyframes per actor -- hops (y up 2-3 px and back), pausing before turning.
- "sway" adds smooth wobble so two keyframes are enough: a falling leaf {"x":3,"y":0,"ms":1600}, drifting snow {"x":1,"y":0,"ms":2400}, bobbing flight {"x":0,"y":2,"ms":1200}, a loop-the-loop in the wind {"x":4,"y":4,"ms":700}.
- To change a character's pose (walk -> sit), end one actor and start another with the new sprite 1 ms later at the same spot.
- For many copies of a small sprite (snow, leaves, stars), give each a different "phase", start time, speed and sway so they don't move in lockstep.
- Ground level: a sprite of height h stands on the bottom at y = 32 - h.
- With "transit", keep characters mostly in the bottom half or passing through quickly so the times stay readable.
- With "black", fill the stage: scenery (trees, a snowman, the moon, stars) as still actors with keyframes at t = 0 and t = duration_ms, then the action in front.

Example of a good answer for "a cat chases a laser dot":
${JSON.stringify(EXAMPLE)}`;

function extractJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Gemini didn't return JSON");
  return JSON.parse(t.slice(start, end + 1));
}

// "Busy" = worth retrying (rate limits, overload, a slow or runaway answer).
const isBusy = (e) => e.status === 429 || e.status === 503 || e.status === 504 || e.slow ||
  /high demand|overloaded|try again later|unavailable/i.test(e.message);

// Gemini sometimes answers "high demand" / rate limited for a few seconds:
// wait and try again before giving up.
async function callGemini(opts) {
  const waits = opts.retryWaits ?? [3000, 8000];
  for (let i = 0; ; i++) {
    try {
      return await callGeminiOnce(opts);
    } catch (e) {
      if (!isBusy(e) || e.slow || e.cancelled || i >= waits.length || opts.deadline - Date.now() < waits[i] + 20000) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

// An answer is a few thousand tokens. Without a cap, a model that gets stuck
// repeating sprite rows ("......") keeps writing for minutes.
const MAX_OUTPUT_TOKENS = 8000;   // good answers use 1,000-3,000 (thinking included)

async function callGeminiOnce({ apiKey, model, contents, fetchImpl = fetch, timeoutMs = 75000, deadline = Infinity,
  lowThinking = true, onAttempt = () => {}, signal }) {
  const ctl = new AbortController();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", () => ctl.abort(), { once: true }); }
  const limit = Math.max(5000, Math.min(timeoutMs, deadline - Date.now()));
  const timer = setTimeout(() => ctl.abort(), limit);
  const t0 = Date.now();
  const report = (extra) => onAttempt({ model, seconds: +((Date.now() - t0) / 1000).toFixed(1), ...extra });
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // Pixel art doesn't need long deliberation; this makes answers much faster.
            ...(lowThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
          },
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      report({ http: res.status, error: msg.slice(0, 200) });
      // Older/other models may not accept thinkingLevel: retry once without it.
      if (lowThinking && res.status === 400 && /thinking/i.test(msg)) {
        return callGeminiOnce({ apiKey, model, contents, fetchImpl, timeoutMs, deadline, lowThinking: false, onAttempt, signal });
      }
      const err = new Error(`Gemini error: ${msg}`);
      err.status = res.status;
      throw err;
    }
    const cand = body?.candidates?.[0] || {};
    const parts = cand.content?.parts || [];
    const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    const u = body.usageMetadata || {};
    report({ http: 200, finish: cand.finishReason, outTokens: u.candidatesTokenCount, thinkTokens: u.thoughtsTokenCount, chars: text.length });
    if (!text) throw new Error("Gemini returned an empty answer" + (cand.finishReason ? ` (${cand.finishReason})` : ""));
    return { text, truncated: cand.finishReason === "MAX_TOKENS" };
  } catch (e) {
    if (e.name === "AbortError") {
      if (signal && signal.aborted) throw Object.assign(new Error("cancelled"), { cancelled: true });
      report({ timeout: true });
      const err = new Error("Gemini took too long to answer. Try again in a minute.");
      err.slow = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Gemini usually answers in about 20 s, but now and then a request hangs. So
// requests are "hedged": if there's no answer after HEDGE_MS, another request
// starts alongside it (then one on the fallback model), and the first usable
// animation wins. A request that fails starts the next one right away.
const DEFAULT_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash"];   // tried if Hydrogen is busy or slow
const TOTAL_BUDGET_MS = 270000;   // the app function times out at 300 s
const HEDGE_MS = 25000;
// Wrong key, bad request, no access: no point trying again.
const isFatal = (e) => [400, 401, 403, 404].includes(e.status);

function generateAnimation(prompt, opts = {}) {
  const first = opts.model || DEFAULT_MODEL;
  const plan = [first, first, ...FALLBACK_MODELS.filter((m) => m !== first), first];   // e.g. Hydrogen, Hydrogen, 3.6, 3.8, Hydrogen
  const hedgeMs = opts.hedgeMs ?? HEDGE_MS;
  const deadline = Date.now() + (opts.budgetMs ?? TOTAL_BUDGET_MS);
  const stop = new AbortController();
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, finished = false, timer = null;
    const errors = [];
    const finish = (fn, v) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stop.abort();   // cancel any request still running
      fn(v);
    };
    const launch = () => {
      clearTimeout(timer);
      if (finished) return;
      if (next >= plan.length || deadline - Date.now() < 15000) {
        if (!running) finish(reject, bestError(errors));
        return;
      }
      const model = plan[next++];
      if (next > 1) console.warn(`Gemini: starting request ${next} (${model})`);
      running++;
      generateWith(prompt, { ...opts, model, deadline, signal: stop.signal }).then(
        (spec) => finish(resolve, spec),
        (e) => {
          running--;
          if (e.cancelled) return;
          errors.push(e);
          if (isFatal(e)) return finish(reject, e);
          launch();   // try the next one now instead of waiting
        });
      timer = setTimeout(launch, hedgeMs);
    };
    launch();
  });
}

function bestError(errors) {
  if (!errors.length) return new Error("Gemini didn't answer in time. Try again in a minute.");
  if (errors.every((e) => isBusy(e))) {
    const e = new Error("Gemini is very busy right now. Try again in a minute.");
    e.status = errors.some((x) => x.status === 429) ? 429 : 503;
    return e;
  }
  return errors.find((e) => !isBusy(e)) || errors[errors.length - 1];
}

async function generateWith(prompt, { apiKey, model, fetchImpl = fetch, retryWaits, deadline = Infinity, timeoutMs, onAttempt, signal } = {}) {
  if (!apiKey) throw new Error("Gemini isn't set up yet (add the GEMINI_API_KEY secret and redeploy).");
  const request = String(prompt || "").trim().slice(0, LIMITS.maxPromptLength);
  if (!request) throw new Error("Describe the animation you want");

  const contents = [{ role: "user", parts: [{ text: request }] }];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt && deadline - Date.now() < 20000) break;
    const { text, truncated } = await callGemini({ apiKey, model, contents, fetchImpl, retryWaits, deadline, timeoutMs, onAttempt, signal });
    try {
      if (truncated) throw new Error("the answer was too long and got cut off; use library assets and keep new sprites small");
      return normalizeSpec(extractJson(text));
    } catch (e) {
      lastErr = e;
      contents.push({ role: "model", parts: [{ text: truncated ? text.slice(0, 2000) : text }] });
      contents.push({ role: "user", parts: [{ text: `That JSON can't be used: ${e.message}. Reply with the corrected, complete JSON only.` }] });
    }
  }
  throw new Error(`Gemini's animation wasn't usable (${lastErr ? lastErr.message : "ran out of time"}). Try rephrasing.`);
}

module.exports = { DEFAULT_MODEL, LIMITS, IMAGE_W, IMAGE_H, normalizeSpec, expandAssets, toDevice, generateAnimation, extractJson, SYSTEM_PROMPT, EXAMPLE };
