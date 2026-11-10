// Extracts the sign's pixel fonts from firmware/mta_sign/fonts.h into
// functions/lib/signfonts.json, so the web app previews use the exact same
// glyphs as the LED panel.   usage: node tools/fonts2json.js [--check]
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../firmware/mta_sign/fonts.h"), "utf8");

function table(name) {
  const start = src.indexOf(name + "[] = {");
  if (start < 0) throw new Error("font table not found: " + name);
  const body = src.slice(start, src.indexOf("\n};", start));
  const out = {};
  const re = /\{'(.)',\s*\{([^}]*)\}\}/g;
  let m;
  while ((m = re.exec(body))) out[m[1]] = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  return out;
}
const json = JSON.stringify({
  small: table("SMALL_FONT"), med: table("MED_FONT"), big: table("BIG_FONT"), retro: table("RETRO_FONT"),
}) + "\n";

const target = path.join(__dirname, "../functions/lib/signfonts.json");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== json) {
    console.error("functions/lib/signfonts.json is out of date: run node tools/fonts2json.js");
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, json);
  console.log("wrote", target);
}
