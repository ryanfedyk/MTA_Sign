const test = require("node:test");
const assert = require("node:assert");
const { planFor, B48_STOP_NB, B48_STOP_SB } = require("../lib/schedule");

// All times written with an explicit New York offset.
const at = (iso) => new Date(iso);

test("weekday morning: L to Manhattan, B48 southbound, two-row layout", () => {
  const p = planFor(at("2026-11-04T08:30:00-05:00")); // Wednesday
  assert.deepStrictEqual(p, { layout: "LB", weekend: false, l: { track: "N", label: "MN" }, b: { stop: B48_STOP_SB, label: "SB" } });
});

test("weekday 1 PM: B48 switches northbound", () => {
  const p = planFor(at("2026-11-04T13:00:00-05:00"));
  assert.strictEqual(p.l.label, "MN");
  assert.deepStrictEqual(p.b, { stop: B48_STOP_NB, label: "NB" });
});

test("weekday 5 PM: L to Brooklyn, B48 northbound", () => {
  const p = planFor(at("2026-11-04T17:15:00-05:00"));
  assert.deepStrictEqual(p.l, { track: "S", label: "BK" });
  assert.strictEqual(p.b.label, "NB");
});

test("weekday 7 PM: back to Manhattan + southbound", () => {
  const p = planFor(at("2026-11-04T19:00:00-05:00"));
  assert.strictEqual(p.l.label, "MN");
  assert.strictEqual(p.b.label, "SB");
});

test("Saturday and Sunday: L to Manhattan only, full screen, all day", () => {
  for (const iso of ["2026-11-07T09:00:00-05:00", "2026-11-07T17:00:00-05:00", "2026-11-08T13:00:00-05:00", "2026-11-08T23:59:00-05:00"]) {
    const p = planFor(at(iso));
    assert.deepStrictEqual(p, { layout: "L", weekend: true, l: { track: "N", label: "MN" }, b: null }, iso);
  }
});

test("uses New York time, not the server's (UTC) clock", () => {
  // 02:00 UTC Saturday = 9 PM Friday in New York -> still a weekday
  const p = planFor(at("2026-11-07T02:00:00Z"));
  assert.strictEqual(p.weekend, false);
  // 03:00 UTC Monday = 10 PM Sunday in New York -> still the weekend
  assert.strictEqual(planFor(at("2026-11-09T03:00:00Z")).weekend, true);
});

test("?dir override forces the bus even on weekends (testing)", () => {
  const p = planFor(at("2026-11-07T10:00:00-05:00"), { busDir: "NB" });
  assert.strictEqual(p.layout, "LB");
  assert.strictEqual(p.b.label, "NB");
});
