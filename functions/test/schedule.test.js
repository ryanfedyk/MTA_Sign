const test = require("node:test");
const assert = require("node:assert");
const { planFor: planFull, B48_STOP_NB, B48_STOP_SB } = require("../lib/schedule");
// Most tests only care about what's shown, not which routes are watched for alerts.
const planFor = (...a) => { const { watch, ...rest } = planFull(...a); return rest; };

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

const { validateBlocks, describePlan, DEFAULT_BLOCKS } = require("../lib/schedule");

test("custom blocks: first match wins, layouts follow what's on", () => {
  const blocks = [
    { days: [6, 0], from: 8 * 60, to: 12 * 60, L: "off", B48: "SB" },     // weekend mornings: bus only
    { days: [0, 1, 2, 3, 4, 5, 6], from: 23 * 60, to: 6 * 60, L: "off", B48: "off" }, // nights: blank (wraps midnight)
    { days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 1440, L: "BK", B48: "NB" },
  ];
  assert.deepStrictEqual(planFor(at("2026-11-07T09:00:00-05:00"), {}, blocks).layout, "B");
  assert.strictEqual(planFor(at("2026-11-07T09:00:00-05:00"), {}, blocks).b.label, "SB");
  assert.strictEqual(planFor(at("2026-11-04T23:30:00-05:00"), {}, blocks).layout, "off");
  assert.strictEqual(planFor(at("2026-11-05T03:00:00-05:00"), {}, blocks).layout, "off", "early-morning part of the wrapping block");
  const p = planFor(at("2026-11-04T14:00:00-05:00"), {}, blocks);
  assert.strictEqual(p.layout, "LB");
  assert.deepStrictEqual(p.l, { track: "S", label: "BK" });
  assert.strictEqual(describePlan(p), "L to Brooklyn + B48 northbound");
});

test("outside every block: L to Manhattan only", () => {
  const p = planFor(at("2026-11-04T09:00:00-05:00"), {}, [{ days: [0], from: 0, to: 60, L: "off", B48: "off" }]);
  assert.strictEqual(p.layout, "L");
  assert.strictEqual(p.l.label, "MN");
});

test("validateBlocks cleans input and rejects nonsense", () => {
  assert.deepStrictEqual(validateBlocks([{ days: [5, "1", 1, 9], from: "60", to: 120, L: "MN", B48: "off" }]),
    [{ days: [1, 5], from: 60, to: 120, mode: "arrivals", L: "MN", B48: "off", Lwhen: "always", Bwhen: "always" }]);
  assert.throws(() => validateBlocks([{ days: [], from: 0, to: 60, L: "MN", B48: "off" }]), /no days/);
  assert.throws(() => validateBlocks([{ days: [1], from: 60, to: 60, L: "MN", B48: "off" }]), /same time/);
  assert.throws(() => validateBlocks([{ days: [1], from: 0, to: 60, L: "Q", B48: "off" }]), /L must/);
  assert.strictEqual(validateBlocks(DEFAULT_BLOCKS).length, 5);
});

test("clock blocks watch their routes; 'issues' routes appear only when there's a problem", () => {
  const blocks = [
    { days: [1, 2, 3, 4, 5], from: 6 * 60, to: 10 * 60, mode: "arrivals", L: "MN", B48: "SB", Lwhen: "always", Bwhen: "issues" },
    { days: [1, 2, 3, 4, 5], from: 10 * 60, to: 24 * 60, mode: "clock", L: "MN", B48: "off" },
  ];
  const morning = at("2026-11-04T08:00:00-05:00"), noon = at("2026-11-04T12:00:00-05:00");
  // bus hidden while it runs fine, shown when it has a problem
  assert.strictEqual(planFull(morning, {}, blocks, {}).layout, "L");
  const withBusIssue = planFull(morning, {}, blocks, { B48: { level: 1 } });
  assert.strictEqual(withBusIssue.layout, "LB");
  assert.deepStrictEqual(withBusIssue.watch, { L: true, B48: true });
  // clock for the rest of the day, watching the L
  const c = planFull(noon, {}, blocks, {});
  assert.strictEqual(c.layout, "clock");
  assert.deepStrictEqual(c.watch, { L: true, B48: false });
  assert.strictEqual(describePlan(c), "Clock (watching L)");
});
