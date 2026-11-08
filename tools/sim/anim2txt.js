// Converts an animation spec (JSON, as Gemini/the app produce) into a plain
// text form the desktop simulator reads, using the same validation and
// device encoding as the cloud.   usage: node anim2txt.js spec.json > out.txt
const fs = require("fs");
const path = require("path");
const anim = require(path.join(__dirname, "../../functions/lib/animations"));
const spec = anim.normalizeSpec(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
const d = anim.toDevice(spec, "sim");
const out = [`D ${d.d} ${d.bg}`, `P ${d.p.join(" ")}`];
for (const s of d.s) {
  out.push(`S ${s.w} ${s.h} ${s.f} ${s.fr.length}`);
  for (const f of s.fr) out.push(`F ${f}`);
}
for (const a of d.a) {
  out.push(`A ${a.s} ${a.o} ${a.k.length}`);
  for (const k of a.k) out.push(`K ${k.join(" ")}`);
}
if (d.img) out.push(`I ${d.img}`);
process.stdout.write(out.join("\n") + "\n");
