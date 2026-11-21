// Calls Gemini directly (no cloud function) and reports how each attempt went:
// time taken, why it stopped, tokens used, and whether the animation was usable.
//   GEMINI_API_KEY=... node tools/gemini-probe.js "a cat chases a mouse" [model]
const anim = require("../functions/lib/animations");
const prompt = process.argv[2] || "a small cat walks across the bottom of the sign";
const model = process.argv[3] || process.env.GEMINI_MODEL || undefined;
const t0 = Date.now();
anim.generateAnimation(prompt, {
  apiKey: process.env.GEMINI_API_KEY, model,
  onAttempt: (info) => console.log("   attempt:", JSON.stringify(info)),
}).then((spec) => {
  console.log(`   OK in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${spec.name}", ${spec.duration_ms} ms, ${spec.sprites.length} sprites, ${spec.actors.length} actors, ${JSON.stringify(spec).length} bytes`);
}).catch((e) => {
  console.log(`   FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e.message}`);
});
