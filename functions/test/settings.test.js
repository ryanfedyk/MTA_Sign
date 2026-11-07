const test = require("node:test");
const assert = require("node:assert");
const s = require("../lib/settings");

test("defaults are a little dimmer than the original 16/6", () => {
  const d = s.withDefaults();
  assert.deepStrictEqual(d.brightness, { day: 12, night: 5 });
  assert.deepStrictEqual(d.idle, { every: 30, style: "walk" });
});

test("messages are cleaned to what the LED font can draw", () => {
  assert.strictEqual(s.cleanMessage("  Dinner’s   ready — come down! 🍝 "), "Dinner's ready - come down!");
  assert.strictEqual(s.cleanMessage("Café"), "Cafe");
  assert.strictEqual(s.cleanMessage("x".repeat(200)).length, 80);
  assert.strictEqual(s.cleanMessage(null), "");
});

test("settings patches are validated and clamped", () => {
  assert.deepStrictEqual(s.validatePatch({ brightness: { day: 500, night: 0 } }), { brightness: { day: 64, night: 1 } });
  assert.deepStrictEqual(s.validatePatch({ idle: { every: "60", style: "mix" } }), { idle: { every: 60, style: "mix" } });
  assert.throws(() => s.validatePatch({ idle: { style: "dog" } }));
  assert.throws(() => s.validatePatch({ brightness: { day: "bright" } }));
});

test("device view only carries fresh commands", () => {
  const now = 1_000_000_000;
  const cfg = s.withDefaults({
    anim: { seq: 3, name: "peek", at: now - 10_000 },
    msg: { seq: 7, text: "Hi", repeat: 2, at: now - 10 * 60_000 }, // 10 min old
  });
  const v = s.deviceView(cfg, now);
  assert.deepStrictEqual(v, { bd: 12, bn: 5, ie: 30, is: "walk", a: { i: 3, n: "peek" } });
  assert.strictEqual(s.deviceView(cfg, now + 120_000).a, undefined);
});
