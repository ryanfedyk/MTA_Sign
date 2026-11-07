// Runs the real `transit` function against fake MTA feeds.
const test = require("node:test");
const assert = require("node:assert");
const { call, fakeFeeds } = require("./helpers");

process.env.MTA_BUS_KEY = "test-key";
const { transit } = require("../index.js");

test("weekday: compact two-row payload the ESP32 expects", async () => {
  const seen = [];
  global.fetch = fakeFeeds(Date.now(), seen);
  const { status, body } = await call(transit, { query: { at: "2026-11-04T09:00:00-05:00" } });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.lay, "LB");
  assert.strictEqual(body.l.dir, "MN");
  assert.strictEqual(body.l.t1, 3);
  assert.strictEqual(body.l.t2, 9);
  assert.deepStrictEqual(body.b, { dir: "SB", t1: 4, live1: true, t2: 20, live2: false });
  assert.ok(seen.some((u) => u.includes("key=test-key")), "bus key passed to MTA");
  assert.ok(JSON.stringify(body).length < 200, "payload stays tiny for the ESP32");
});

test("weekday evening: L to Brooklyn", async () => {
  global.fetch = fakeFeeds(Date.now());
  const { body } = await call(transit, { query: { at: "2026-11-04T17:00:00-05:00" } });
  assert.strictEqual(body.l.dir, "BK");
  assert.strictEqual(body.l.t1, 5);
  assert.strictEqual(body.b.dir, "NB");
});

test("weekend: L only, bus feeds not even requested, bus row blank", async () => {
  const seen = [];
  global.fetch = fakeFeeds(Date.now(), seen);
  const { body } = await call(transit, { query: { at: "2026-11-07T11:00:00-05:00" } });
  assert.strictEqual(body.lay, "L");
  assert.strictEqual(body.l.dir, "MN");
  assert.strictEqual(body.l.t1, 3);
  assert.deepStrictEqual(body.b, { dir: "", t1: -1, live1: true, t2: -1, live2: true });
  assert.deepStrictEqual(seen.filter((u) => u.includes("bustime")), []);
});

test("?dir=NB forces the northbound bus", async () => {
  global.fetch = fakeFeeds(Date.now());
  const { body } = await call(transit, { query: { dir: "NB", at: "2026-11-04T09:00:00-05:00" } });
  assert.strictEqual(body.b.dir, "NB");
});

test("upstream outages degrade to -- instead of erroring", async () => {
  global.fetch = async () => { throw new Error("network down"); };
  const { status, body } = await call(transit, { query: { at: "2026-11-04T09:00:00-05:00" } });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.l.t1, -1);
  assert.strictEqual(body.b.t1, -1);
});

test("bad ?at= is rejected", async () => {
  const { status } = await call(transit, { query: { at: "not-a-date" } });
  assert.strictEqual(status, 400);
});
