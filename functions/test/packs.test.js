// Seasonal packs: every animation is valid and fits the sign, and adding a
// pack from the app puts its animations on the sign.
const test = require("node:test");
const assert = require("node:assert");
const { call } = require("./helpers");
const settings = require("../lib/settings");
const animations = require("../lib/animations");
const seasonal = require("../lib/packs");
const { setStore } = require("../lib/store");

process.env.SIGN_APP_PIN = "purple cat 42";
const { app, anims, sign } = require("../index.js");
const PIN = { "x-sign-pin": "purple cat 42" };

test("there's a Thanksgiving pack and a big Christmas pack", () => {
  const ids = seasonal.packs().map((p) => p.id);
  assert.deepStrictEqual(ids, ["thanksgiving", "christmas"]);
  assert.ok(seasonal.findPack("thanksgiving").animations.length >= 5);
  assert.ok(seasonal.findPack("christmas").animations.length >= 8);
});

test("every pack animation is valid, within the sign's limits, and the same every time", () => {
  for (const p of seasonal.packs()) {
    for (const a of p.animations) {
      const again = animations.normalizeSpec(a.spec);
      assert.deepStrictEqual(again, a.spec, `${a.id} changes when re-validated`);
      assert.ok(Object.keys(a.spec.palette).length <= 15, `${a.id} has too many colors`);
      assert.ok(a.spec.actors.every((x) => x.keyframes.length <= animations.LIMITS.maxKeys), `${a.id} keyframes`);
      const dev = animations.toDevice(a.spec, a.id);
      assert.ok(a.id.length < 32, `${a.id} id too long for the sign`);
      assert.ok(JSON.stringify(dev).length < 16000, `${a.id} is too big for one download page`);
      // everything shows up at some point: every actor is on screen at some time
      for (const [i, act] of a.spec.actors.entries()) {
        const sp = a.spec.sprites[act.sprite];
        const w = sp.frames[0][0].length, h = sp.frames[0].length;
        const ks = act.keyframes, seen = [];
        for (let j = 0; j < ks.length; j++) {
          const k1 = ks[Math.min(j + 1, ks.length - 1)];
          for (let f = 0; f <= 1; f += 0.1) seen.push([ks[j].x + (k1.x - ks[j].x) * f, ks[j].y + (k1.y - ks[j].y) * f]);
        }
        assert.ok(seen.some(([x, y]) => x + w > 0 && x < 64 && y + h > 0 && y < 32), `${a.id} actor ${i} never on screen`);
      }
    }
  }
  // seeded, so building again gives identical art
  const first = JSON.stringify(seasonal.packs());
  assert.strictEqual(JSON.stringify(seasonal.packs()), first);
});

test("adding a pack puts it on the sign and into the idle rotation", async () => {
  const store = settings.memoryStore();
  setStore(store);
  let r = await call(app, { path: "/api/packs", headers: PIN });
  assert.strictEqual(r.status, 200);
  const xmas = r.body.packs.find((p) => p.id === "christmas");
  assert.strictEqual(xmas.on, false);
  assert.ok(xmas.animations[0].spec.sprites.length);

  const v0 = (await call(sign)).body.lv;
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "christmas", on: true } });
  assert.deepStrictEqual([r.body.on, r.body.idle, r.body.idleStyle], [true, true, "mix"]);   // the cat-only idle switched to mix
  assert.notStrictEqual((await call(sign)).body.lv, v0);                                         // the sign re-downloads

  // the sign downloads it page by page
  const ids = [];
  let page = 0, pages = 1;
  for (; page < pages; page++) {
    const p = await call(anims, { query: { page } });
    pages = p.body.n;
    assert.ok(JSON.stringify(p.body).length < 20000, "page too big");
    for (const a of p.body.a) { ids.push(a.id); assert.strictEqual(a.i, 1); }
  }
  assert.ok(pages > 1);
  assert.deepStrictEqual(ids, seasonal.findPack("christmas").animations.map((a) => a.id));

  // older firmware still gets a small single download
  const legacy = await call(anims);
  assert.strictEqual(legacy.body.n, undefined);
  assert.ok(JSON.stringify(legacy.body).length <= animations.LIMITS.maxDeviceBytes + 100);

  // play one now
  r = await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "c:christmas.snowman" } });
  assert.strictEqual(r.status, 200);
  r = await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "c:thanksgiving.turkey" } });
  assert.strictEqual(r.status, 400, "packs that aren't added can't be played");

  // keep the pack but take it out of the idle rotation, then remove it
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "christmas", idle: false } });
  assert.deepStrictEqual([r.body.on, r.body.idle], [true, false]);
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "christmas", on: false } });
  assert.strictEqual(r.body.on, false);
  assert.deepStrictEqual((await call(anims, { query: { page: 0 } })).body.a, []);
});

test("the sign reports its free memory, shown in the app", async () => {
  const store = settings.memoryStore();
  setStore(store);
  require("../index.js")._resetCheckIn();
  await call(sign, { query: { fw: 31, h: 123456, mh: 98765 } });
  const r = await call(app, { path: "/api/settings", headers: PIN });
  assert.deepStrictEqual([r.body.firmware, r.body.freeMemory, r.body.lowestMemory], [31, 123456, 98765]);
});

test("each pack animation can be in or out of the idle rotation on its own", async () => {
  setStore(settings.memoryStore());
  const idleOnSign = async () => {
    const out = {};
    for (let page = 0, pages = 1; page < pages; page++) {
      const p = await call(anims, { query: { page } });
      pages = p.body.n;
      for (const a of p.body.a) out[a.id] = a.i;
    }
    return out;
  };
  let r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", anim: "thanksgiving.turkey", idle: true } });
  assert.strictEqual(r.status, 400, "the pack has to be added first");

  await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", on: true } });
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", anim: "thanksgiving.leaves", idle: false } });
  assert.deepStrictEqual([r.body.idle, r.body.skip], [true, ["thanksgiving.leaves"]]);
  let sign = await idleOnSign();
  assert.strictEqual(sign["thanksgiving.leaves"], 0);
  assert.strictEqual(sign["thanksgiving.turkey"], 1);
  assert.strictEqual((await call(app, { path: "/api/packs", headers: PIN })).body.packs[0].skip[0], "thanksgiving.leaves");

  // turn the whole pack's idle off, then pick just one
  await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", idle: false } });
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", anim: "thanksgiving.turkey", idle: true } });
  assert.strictEqual(r.body.idle, true);
  sign = await idleOnSign();
  assert.deepStrictEqual(Object.entries(sign).filter(([, i]) => i).map(([id]) => id), ["thanksgiving.turkey"]);

  // taking the last one out turns the pack's idle off; the pack switch brings them all back
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", anim: "thanksgiving.turkey", idle: false } });
  assert.deepStrictEqual([r.body.idle, r.body.skip], [false, []]);
  r = await call(app, { method: "POST", path: "/api/packs", headers: PIN, body: { id: "thanksgiving", idle: true } });
  assert.deepStrictEqual([r.body.idle, r.body.skip], [true, []]);
  assert.ok(Object.values(await idleOnSign()).every((i) => i === 1));
});
