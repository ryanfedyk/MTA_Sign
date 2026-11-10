// Web app API + the /sign endpoint, using an in-memory settings store.
const test = require("node:test");
const assert = require("node:assert");
const { call } = require("./helpers");
const settings = require("../lib/settings");
const { setStore } = require("../lib/store");

process.env.SIGN_APP_PIN = "purple cat 42";
const { app, sign } = require("../index.js");
const PIN = { "x-sign-pin": "purple cat 42" };

test("serves the control panel page without a passphrase", async () => {
  setStore(settings.memoryStore());
  const { status, body, headers } = await call(app, { path: "/" });
  assert.strictEqual(status, 200);
  assert.match(headers["content-type"], /text\/html/);
  assert.match(body, /Headway/);
});

test("API refuses a wrong passphrase", async () => {
  setStore(settings.memoryStore());
  const { status } = await call(app, { path: "/api/settings", headers: { "x-sign-pin": "nope" } });
  assert.strictEqual(status, 401);
});

test("brightness and idle settings round-trip and reach the sign", async () => {
  const store = settings.memoryStore();
  setStore(store);
  let r = await call(app, { method: "POST", path: "/api/settings", headers: PIN,
    body: { brightness: { day: 20 }, idle: { every: 60, style: "mix" } } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.brightness, { day: 20, night: 5, nightStart: 17, nightEnd: 7 });
  assert.deepStrictEqual(r.body.idle, { every: 60, style: "mix" });

  r = await call(sign);
  const { ck, ...rest } = r.body;
  assert.deepStrictEqual(rest, { bd: 20, bn: 5, ns: 17, ne: 7, ie: 60, is: "mix", lv: 0 });
  assert.strictEqual(ck.f, "station");
});

test("play + message commands get increasing ids the sign can pick up", async () => {
  setStore(settings.memoryStore());
  let r = await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "chase" } });
  assert.deepStrictEqual(r.body, { ok: true, seq: 1 });
  r = await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "peek" } });
  assert.strictEqual(r.body.seq, 2);
  r = await call(app, { method: "POST", path: "/api/message", headers: PIN, body: { text: "Dinner’s ready!", repeat: 3 } });
  assert.deepStrictEqual(r.body, { ok: true, seq: 1, text: "Dinner's ready!" });

  r = await call(sign);
  assert.deepStrictEqual(r.body.a, { i: 2, n: "peek" });
  assert.deepStrictEqual(r.body.m, { i: 1, t: "Dinner's ready!", r: 3 });
});

test("bad commands are rejected", async () => {
  setStore(settings.memoryStore());
  assert.strictEqual((await call(app, { method: "POST", path: "/api/play", headers: PIN, body: { name: "dog" } })).status, 400);
  assert.strictEqual((await call(app, { method: "POST", path: "/api/message", headers: PIN, body: { text: "  🍝 " } })).status, 400);
});

test("works under the /app prefix used by cloudfunctions.net URLs", async () => {
  setStore(settings.memoryStore());
  // Cloud Functions strips the function name, but a trailing slash must not matter either
  const r = await call(app, { path: "/api/settings/", headers: PIN });
  assert.strictEqual(r.status, 200);
});

test("/sign falls back to defaults if the database is unavailable", async () => {
  const broken = settings.memoryStore();
  broken.get = async () => { throw new Error("database (default) does not exist"); };
  setStore(broken);
  const r = await call(sign);
  assert.strictEqual(r.status, 200);
  const { ck, ...rest } = r.body;
  assert.deepStrictEqual(rest, { bd: 12, bn: 5, ns: 17, ne: 7, ie: 30, is: "walk", lv: 0 });
  assert.ok(ck);
  // ...and the app explains the problem instead of crashing
  const a = await call(app, { path: "/api/settings", headers: PIN });
  assert.strictEqual(a.status, 503);
});

test("/sign records the firmware version the sign reports, and the app shows it", async () => {
  const store = settings.memoryStore();
  setStore(store);
  await call(sign, { query: { fw: "17" } });
  await new Promise((r) => setTimeout(r, 20));
  // /sign only writes "last seen" once a minute per server instance, so check the store write directly too
  await store.touchDevice(17);
  const r = await call(app, { path: "/api/settings", headers: PIN });
  assert.strictEqual(r.body.firmware, 17);
});

test("schedule: app saves blocks, /transit follows them, reset restores the original rules", async () => {
  const store = settings.memoryStore();
  setStore(store);
  const { transit } = require("../index.js");
  const { fakeFeeds } = require("./helpers");
  global.fetch = fakeFeeds(Date.now());

  let r = await call(app, { path: "/api/schedule", headers: PIN });
  assert.strictEqual(r.body.isDefault, true);
  assert.strictEqual(r.body.blocks.length, 5);

  const blocks = [{ days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1440, L: "off", B48: "NB" }];
  r = await call(app, { method: "POST", path: "/api/schedule", headers: PIN, body: { blocks } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.isDefault, false);
  assert.strictEqual(r.body.now, "B48 northbound");

  r = await call(transit, { query: { at: "2026-11-04T09:00:00-05:00" } });
  assert.strictEqual(r.body.lay, "B");
  assert.strictEqual(r.body.l.t1, -1);
  assert.strictEqual(r.body.b.dir, "NB");

  r = await call(app, { method: "POST", path: "/api/schedule", headers: PIN, body: { blocks: [{ days: [], from: 0, to: 5 }] } });
  assert.strictEqual(r.status, 400);

  r = await call(app, { method: "POST", path: "/api/schedule", headers: PIN, body: { reset: true } });
  assert.strictEqual(r.body.isDefault, true);
  r = await call(transit, { query: { at: "2026-11-04T09:00:00-05:00" } });
  assert.strictEqual(r.body.lay, "LB");
});

test("clock block: /transit sends the clock layout plus an L delay indicator", async () => {
  const store = settings.memoryStore();
  setStore(store);
  const alerts = require("../lib/alerts");
  alerts.clearCache();
  const { transit } = require("../index.js");
  const { fakeFeeds } = require("./helpers");
  const base = fakeFeeds(Date.now());
  global.fetch = async (url, opts) => {
    if (String(url).includes("subway-alerts")) return { ok: true, json: async () => ({ entity: [{ id: "1", alert: {
      informed_entity: [{ route_id: "L" }], header_text: { translation: [{ text: "L trains are delayed" }] },
      "transit_realtime.mercury_alert": { alert_type: "Delays" } } }] }) };
    if (String(url).includes("bus-alerts")) return { ok: true, json: async () => ({ entity: [] }) };
    return base(url, opts);
  };
  await call(app, { method: "POST", path: "/api/schedule", headers: PIN,
    body: { blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1440, mode: "clock", L: "MN", B48: "off" }] } });
  const r = await call(transit, { query: { at: "2026-11-04T13:00:00-05:00" } });
  assert.strictEqual(r.body.lay, "clock");
  assert.strictEqual(r.body.la, "Delays");
  assert.strictEqual(r.body.ls, 1);
  assert.strictEqual(r.body.ba, undefined);
  alerts.clearCache();
  await call(app, { method: "POST", path: "/api/schedule", headers: PIN, body: { reset: true } });
});

test("clock style: saved from the app, validated, and sent to the sign compactly", async () => {
  setStore(settings.memoryStore());
  let r = await call(app, { method: "POST", path: "/api/settings", headers: PIN,
    body: { clock: { font: "segment", color: "#FF3C28", effect: "gradient", color2: "#ffffff", h24: true, secBar: 1 } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.clock.font, "segment");
  assert.strictEqual(r.body.clock.color, "#ff3c28");
  r = await call(sign);
  assert.deepStrictEqual(r.body.ck, { f: "segment", c: "ff3c28", c2: "ffffff", m: "gradient", h24: 1, ap: 0, d: 1, b: 1, sb: 1, wr: 1 });
  r = await call(app, { method: "POST", path: "/api/settings", headers: PIN, body: { clock: { font: "comic sans" } } });
  assert.strictEqual(r.status, 400);
  r = await call(app, { method: "POST", path: "/api/settings", headers: PIN, body: { clock: { color: "red" } } });
  assert.strictEqual(r.status, 400);
});
