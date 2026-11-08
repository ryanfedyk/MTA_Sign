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

const LIMITS = {
  maxW: 48, maxH: 32, maxFrames: 8, maxSprites: 6, maxActors: 8, maxKeys: 24,
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
 * Validate and repair a spec (from Gemini or the app). Returns a clean spec or
 * throws an Error whose message explains what's wrong (fed back to Gemini).
 */
function normalizeSpec(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Animation must be a JSON object");
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
        x: clampInt(k?.x, -64, 127, 0),
        y: clampInt(k?.y, -40, 71, 0),
        flip: Boolean(k?.flip),
      }))
      .sort((p, q) => p.t - q.t)
      .slice(0, LIMITS.maxKeys);
    if (!keys.length) throw new Error(`actor ${i} has no keyframes`);
    return { sprite, outline: a.outline !== false, keyframes: keys };
  });

  return { name, duration_ms: duration, background, palette, sprites, actors };
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
    a: spec.actors.map((a) => ({ s: a.sprite, o: a.outline ? 1 : 0, k: a.keyframes.map((k) => [k.t, k.x, k.y, k.flip ? 1 : 0]) })),
  };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
const EXAMPLE = {
  name: "Orange cat strolls by",
  duration_ms: 4500,
  background: "transit",
  palette: { o: "#ff7d0f", d: "#a53700", w: "#ffe1af", p: "#ff698c", e: "#78ff50" },
  sprites: [{
    name: "cat walking right",
    frame_ms: 140,
    frames: [
      [".o........o....o", "o.........oo..oo", "o.........oooooo", "o.........oeooeo", ".ooodoodooowppwo", "..oodoodoooowwo.",
        "..oodoodoooo....", "..oooooooooo....", "..owwwwwwwoo....", "..o..o...o..o...", ".o...o..o....o.."],
      ["o.........o....o", "o.........oo..oo", "o.........oooooo", ".o........oeooeo", ".ooodoodooowppwo", "..oodoodoooowwo.",
        "..oodoodoooo....", "..oooooooooo....", "..owwwwwwwoo....", "...o.o....o.o...", "...o.o....o.o..."],
    ],
  }],
  actors: [{ sprite: 0, outline: true, keyframes: [{ t: 0, x: -16, y: 21, flip: false }, { t: 4400, x: 64, y: 21, flip: false }] }],
};

const SYSTEM_PROMPT = `You are a pixel-art animator for a 64x32 RGB LED matrix sign that hangs in a home and shows subway arrival times.
You turn a short request into a small animation and reply with ONLY a JSON object (no prose, no code fences).

Canvas: x 0..63 left to right, y 0..31 top to bottom. Each pixel is one LED, so everything must read at tiny size.

JSON format:
{
  "name": short title (max 40 chars),
  "duration_ms": total length, 2000-10000,
  "background": "transit" (drawn on top of the live arrival times, like a character passing in front of the sign) or "black" (a full-screen scene),
  "palette": { single-character key: "#RRGGBB" }, max 15 colors; "." is always transparent and must not be in the palette,
  "sprites": [ { "name": text, "frame_ms": time per frame 60-400, "frames": [ [row strings...], ...1-8 frames ] } ],
  "actors": [ { "sprite": index into sprites, "outline": true/false, "keyframes": [ { "t": ms, "x": int, "y": int, "flip": bool }, ... ] } ]
}

Rules:
- Every row of every frame of a sprite has the same length; every frame of a sprite has the same number of rows. Max sprite size 40 wide x 32 tall. Typical characters are 10-20 px wide.
- Each character in a row is either "." (transparent) or a palette key.
- x, y is the sprite's top-left corner. Actors move in a straight line between keyframes and are hidden before their first and after their last keyframe. Start/end off-screen (e.g. x = -width or x = 64) for entrances and exits.
- Sprites face right; set "flip": true to face left.
- Frames loop while the actor is visible: use 2-4 frames for walking/flapping cycles.
- Use bright, saturated colors; dark colors look like "off" LEDs. Give characters a clear silhouette and 1-2 px features (eyes, ears) that read at tiny size.
- "outline": true adds a 1 px dark halo so the actor stays readable over the arrival-time text. Use it for "transit" backgrounds.
- With "transit", keep the action quick (3-6 s) and prefer the bottom half or a pass across the screen. With "black", you can fill the screen and tell a tiny story; you may add a still sprite (one frame, keyframes at t=0 and t=duration) as scenery.
- Multiple actors are encouraged for interaction (a cat chasing a mouse, birds flying in formation, rain drops, etc.).

Example of a good answer for "a cat walks across":
${JSON.stringify(EXAMPLE)}`;

function extractJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Gemini didn't return JSON");
  return JSON.parse(t.slice(start, end + 1));
}

async function callGemini({ apiKey, model, contents, fetchImpl = fetch, timeoutMs = 240000, lowThinking = true }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
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
            temperature: 0.9,
            // Pixel art doesn't need long deliberation; this makes answers much faster.
            ...(lowThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
          },
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      // Older/other models may not accept thinkingLevel: retry once without it.
      if (lowThinking && res.status === 400 && /thinking/i.test(msg)) {
        return callGemini({ apiKey, model, contents, fetchImpl, timeoutMs, lowThinking: false });
      }
      const err = new Error(`Gemini error: ${msg}`);
      err.status = res.status;
      throw err;
    }
    const parts = body?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    if (!text) throw new Error("Gemini returned an empty answer" + (body?.candidates?.[0]?.finishReason ? ` (${body.candidates[0].finishReason})` : ""));
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Gemini took too long to answer. Try a simpler idea or try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Gemini for an animation. Retries once, telling Gemini what was wrong,
 * if the first answer can't be used.
 */
async function generateAnimation(prompt, { apiKey, model = "gemini-3.8-flash", fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("Gemini isn't set up yet (add the GEMINI_API_KEY secret and redeploy).");
  const request = String(prompt || "").trim().slice(0, LIMITS.maxPromptLength);
  if (!request) throw new Error("Describe the animation you want");

  const contents = [{ role: "user", parts: [{ text: request }] }];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callGemini({ apiKey, model, contents, fetchImpl });
    try {
      return normalizeSpec(extractJson(text));
    } catch (e) {
      lastErr = e;
      contents.push({ role: "model", parts: [{ text }] });
      contents.push({ role: "user", parts: [{ text: `That JSON can't be used: ${e.message}. Reply with the corrected JSON only.` }] });
    }
  }
  throw new Error(`Gemini's animation wasn't usable (${lastErr.message}). Try rephrasing.`);
}

module.exports = { LIMITS, normalizeSpec, toDevice, generateAnimation, extractJson, SYSTEM_PROMPT, EXAMPLE };
