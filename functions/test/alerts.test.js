const test = require("node:test");
const assert = require("node:assert");
const alerts = require("../lib/alerts");

const now = Date.parse("2026-11-10T15:00:00Z");
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const alert = (route, type, header, start = "2026-11-10T14:00:00Z", end = "2026-11-10T18:00:00Z") => ({
  id: route + type,
  alert: {
    active_period: [{ start: sec(start), end: sec(end) }],
    informed_entity: [{ agency_id: "MTASBWY", route_id: route }],
    header_text: { translation: [{ text: header, language: "en" }] },
    "transit_realtime.mercury_alert": { alert_type: type },
  },
});

test("L delays are found; other routes and expired alerts are ignored", () => {
  const feed = { entity: [
    alert("L", "Delays", "L trains are running with delays in both directions"),
    alert("G", "Suspended", "No G trains"),
    alert("L", "Part Suspended", "No L trains between...", "2026-11-09T00:00:00Z", "2026-11-09T05:00:00Z"),  // expired
  ] };
  const s = alerts.summarize(feed, null, now);
  assert.deepStrictEqual({ level: s.L.level, label: s.L.label }, { level: 1, label: "Delays" });
  assert.strictEqual(s.B48.level, 0);
});

test("most severe wins; camelCase JSON is understood too", () => {
  const feed = { entity: [
    alert("L", "Delays", "Delays"),
    { id: "x", alert: { activePeriod: [], informedEntity: [{ routeId: "L" }],
      headerText: { translation: [{ text: "No L trains running between 8 Av and Lorimer" }] },
      mercuryAlert: { alertType: "Part Suspended" } } },
  ] };
  assert.deepStrictEqual(alerts.summarize(feed, null, now).L.label, "Suspended");
  assert.strictEqual(alerts.summarize(feed, null, now).L.level, 2);
});

test("planned work and service changes are labelled; bus route ids with prefixes match", () => {
  assert.strictEqual(alerts.classify(alert("L", "Planned - Stops Skipped", "Trains skip Bedford Av").alert).label, "Planned");
  assert.strictEqual(alerts.classify(alert("L", "Reroute", "Trains rerouted").alert).label, "Changes");
  const bus = { entity: [{ id: "b", alert: { informed_entity: [{ route_id: "MTA NYCT_B48" }], header_text: { translation: [{ text: "B48 detoured" }] } } }] };
  assert.strictEqual(alerts.summarize(null, bus, now).B48.label, "Changes");
});

test("currentAlerts caches and tolerates feed failures", async () => {
  alerts.clearCache();
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("down"); };
  const a = await alerts.currentAlerts({ fetchImpl, nowMs: now });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.L.level, 0);
  await alerts.currentAlerts({ fetchImpl, nowMs: now + 1000 });
  assert.strictEqual(calls, 2, "second call served from cache");
  alerts.clearCache();
});
