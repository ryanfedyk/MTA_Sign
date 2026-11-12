// Runs the real `transit` function against fake MTA feeds.
const test = require("node:test");
const assert = require("node:assert");
const { call, fakeFeeds } = require("./helpers");

process.env.MTA_BUS_KEY = "test-key";
require("../lib/store").setStore(require("../lib/settings").memoryStore());
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

test("B48: buses at the terminal / on their previous run still count (matches other apps)", () => {
  const { parseBus } = require("../lib/transit");
  const now = Date.parse("2026-11-12T12:25:00Z");
  const iso = (m) => new Date(now + m * 60000).toISOString();
  const visit = (trip, vehicle, progress, expMin, aimedMin) => ({ MonitoredVehicleJourney: {
    PublishedLineName: "B48", VehicleRef: vehicle, ProgressStatus: progress,
    FramedVehicleJourneyRef: { DatedVehicleJourneyRef: trip },
    MonitoredCall: { ExpectedArrivalTime: expMin == null ? undefined : iso(expMin), AimedArrivalTime: iso(aimedMin) } } });
  // This morning's case: #7211 en route (11 min), #9551 on layover at the terminal (19 min),
  // a scheduled trip (30 min) that only OneBusAway knows, #5009 on its previous run with no prediction (63 min).
  const siri = { Siri: { ServiceDelivery: { StopMonitoringDelivery: [{ MonitoredStopVisit: [
    visit("T403", "MTA NYCT_7211", undefined, 11.5, 9),
    visit("T416", "MTA NYCT_9551", "layover", 19.4, 17),
    visit("T409", "MTA NYCT_5009", "prevTrip", null, 63.2),
  ] }] } } };
  const oba = { currentTime: now, data: { arrivalsAndDepartures: [
    { routeShortName: "B48", tripId: "T417", predicted: false, scheduledArrivalTime: now + 30.2 * 60000 },
  ] } };
  const { arrivals } = parseBus(oba, siri, now);
  assert.deepStrictEqual(arrivals.map((a) => [a.min, a.live]), [[11, true], [19, true], [30, false], [63, false]]);
});

test("B48: the same trip in both feeds is counted once, preferring the live prediction", () => {
  const { parseBus } = require("../lib/transit");
  const now = Date.now();
  const siri = { Siri: { ServiceDelivery: { StopMonitoringDelivery: [{ MonitoredStopVisit: [{ MonitoredVehicleJourney: {
    VehicleRef: "v1", FramedVehicleJourneyRef: { DatedVehicleJourneyRef: "T1" },
    MonitoredCall: { ExpectedArrivalTime: new Date(now + 7.3 * 60000).toISOString() } } }] }] } } };
  const oba = { currentTime: now, data: { arrivalsAndDepartures: [
    { routeShortName: "B48", tripId: "T1", predicted: false, scheduledArrivalTime: now + 5 * 60000 },
  ] } };
  assert.deepStrictEqual(parseBus(oba, siri, now).arrivals, [{ min: 7, live: true }]);
});
