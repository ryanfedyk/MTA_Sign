const test = require("node:test");
const assert = require("node:assert");
const anim = require("../lib/animations");
const { call } = require("./helpers");
const settings = require("../lib/settings");
const { setStore } = require("../lib/store");

process.env.SIGN_APP_PIN = "purple cat 42";
const PIN = { "x-sign-pin": "purple cat 42" };
const { app, anims, sign } = require("../index.js");

test("the built-in example is a valid spec", () => {
  const s = anim.normalizeSpec(anim.EXAMPLE);
  assert.strictEqual(s.sprites[0].frames[0][0].length, 16);
  assert.strictEqual(s.actors[0].keyframes.length, 2);
});

test("normalizeSpec repairs ragged rows, unknown colors and out-of-range numbers", () => {
  const s = anim.normalizeSpec({
    name: "Test 🐱", duration_ms: 999999, background: "space",
    palette: { o: "#f80", ".": "#fff", xx: "#000", b: "blue", w: "#FFFFFF" },
    sprites: [{ frame_ms: 5, frames: [["oo", "ozw"], ["o"]] }],
    actors: [{ sprite: 9, keyframes: [{ t: 5000, x: 500, y: 3 }, { t: 0, x: -10, y: 3, flip: 1 }] }],
  });
  assert.strictEqual(s.name, "Test");
  assert.strictEqual(s.duration_ms, anim.LIMITS.maxDuration);
  assert.strictEqual(s.background, "transit");
  assert.deepStrictEqual(Object.keys(s.palette), ["o", "w"]);
  assert.strictEqual(s.palette.o, "#ff8800");
  assert.deepStrictEqual(s.sprites[0].frames, [["oo.", "o.w"], ["o..", "..."]]);
  assert.strictEqual(s.sprites[0].frame_ms, 40);
  assert.strictEqual(s.actors[0].sprite, 0);
  assert.deepStrictEqual(s.actors[0].keyframes.map((k) => k.t), [0, 5000]);
  assert.strictEqual(s.actors[0].keyframes[1].x, 127);
  assert.strictEqual(s.actors[0].keyframes[0].flip, true);
});

test("normalizeSpec rejects unusable answers with a helpful reason", () => {
  assert.throws(() => anim.normalizeSpec({ palette: {}, sprites: [], actors: [] }), /palette/);
  assert.throws(() => anim.normalizeSpec({ palette: { o: "#fff" }, sprites: [{ frames: [["xx"]] }], actors: [{ keyframes: [{}] }] }), /missing from the palette/);
});

test("device format uses palette indexes and stays compact", () => {
  const s = anim.normalizeSpec(anim.EXAMPLE);
  const d = anim.toDevice(s, "abc", { idle: true });
  assert.strictEqual(d.p.length, 5);
  assert.strictEqual(d.p[0], "ff7d0f");
  assert.strictEqual(d.s[0].fr[0].length, 16 * 11);
  assert.match(d.s[0].fr[0], /^[.0-4]+$/);
  assert.deepStrictEqual(d.a[0].k[1], [4400, 64, 21, 0]);
  assert.strictEqual(d.i, 1);
  assert.ok(JSON.stringify(d).length < 1000);
});

function fakeGemini(answers, seen = []) {
  return async (url, opts) => {
    seen.push({ url, body: JSON.parse(opts.body), key: opts.headers["x-goog-api-key"] });
    const text = answers.shift();
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
}

test("generateAnimation asks Gemini and retries once with the problem", async () => {
  const seen = [];
  const fetchImpl = fakeGemini(["```json\n{\"oops\": true}\n```", JSON.stringify(anim.EXAMPLE)], seen);
  const spec = await anim.generateAnimation("a cat walks", { apiKey: "k", model: "m1", fetchImpl });
  assert.strictEqual(spec.name, "Orange cat strolls by");
  assert.strictEqual(seen.length, 2);
  assert.match(seen[0].url, /models\/m1:generateContent$/);
  assert.strictEqual(seen[0].key, "k");
  assert.strictEqual(seen[0].body.generationConfig.responseMimeType, "application/json");
  assert.match(seen[1].body.contents.at(-1).parts[0].text, /can't be used/);
});

test("generateAnimation explains missing setup and Gemini errors", async () => {
  await assert.rejects(anim.generateAnimation("x", {}), /GEMINI_API_KEY/);
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) });
  await assert.rejects(anim.generateAnimation("x", { apiKey: "k", fetchImpl }), /quota/);
});

test("app: generate -> library -> play -> sign sees new library version + command", async () => {
  const store = settings.memoryStore();
  setStore(store);
  process.env.GEMINI_API_KEY = "test";
  const realFetch = global.fetch;
  global.fetch = fakeGemini([JSON.stringify(anim.EXAMPLE)]);
  try {
    let r = await call(app, { method: "POST", path: "/api/animations/generate", headers: PIN, body: { prompt: "a cat walks" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const id = r.body.animation.id;

    r = await call(app, { path: "/api/animations", headers: PIN });
    assert.strictEqual(r.body.animations.length, 1);
    assert.strictEqual(r.body.geminiReady, true);

    r = await call(app, { method: "POST", path: "/api/animations/update", headers: PIN, body: { id, inIdle: true } });
    assert.strictEqual(r.status, 200);

    r = await call(anims);
    assert.strictEqual(r.body.a.length, 1);
    assert.strictEqual(r.body.a[0].id, id);
    assert.strictEqual(r.body.a[0].i, 1);
    const libVersion = r.body.v;
    assert.ok(libVersion > 0);

    r = await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "c:" + id } });
    assert.strictEqual(r.status, 200);
    r = await call(sign);
    assert.strictEqual(r.body.lv, libVersion);
    assert.deepStrictEqual(r.body.a, { i: 1, n: "c:" + id });

    r = await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "c:nope" } });
    assert.strictEqual(r.status, 400);

    r = await call(app, { method: "POST", path: "/api/animations/delete", headers: PIN, body: { id } });
    assert.strictEqual((await call(anims)).body.a.length, 0);
  } finally {
    global.fetch = realFetch;
  }
});

test("app: idle style 'mine' is accepted", async () => {
  setStore(settings.memoryStore());
  const r = await call(app, { method: "POST", path: "/api/settings", headers: PIN, body: { idle: { style: "mine" } } });
  assert.strictEqual(r.body.idle.style, "mine");
});

test("Gemini is asked for low thinking, and retried without it if the model refuses", async () => {
  const bodies = [];
  let first = true;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body); bodies.push(body);
    if (first) { first = false; return { ok: false, status: 400, json: async () => ({ error: { message: "thinking_level is not supported" } }) }; }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(anim.EXAMPLE) }] } }] }) };
  };
  const spec = await anim.generateAnimation("cat", { apiKey: "k", fetchImpl });
  assert.ok(spec.sprites.length);
  assert.deepStrictEqual(bodies[0].generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assert.strictEqual(bodies[1].generationConfig.thinkingConfig, undefined);
});
