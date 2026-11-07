// Reads the GCP_SA_KEY secret and writes a valid service-account JSON file.
// Tolerates the common copy/paste damage: line breaks inserted by the
// terminal when copying a long line, Windows line endings, surrounding
// whitespace, or the key pasted base64-encoded.
// Usage: node write-gcp-key.js <output-path>   (secret in env GCP_SA_KEY)
const fs = require("fs");

const raw = (process.env.GCP_SA_KEY || "").trim();
const out = process.argv[2];

function tryParse(text) {
  try {
    const j = JSON.parse(text);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

function repair(text) {
  // 1) As pasted.
  let j = tryParse(text);
  if (j) return j;
  // 2) Remove stray line breaks. A real key keeps its newlines as the
  //    two characters "\n", so raw line breaks are never needed.
  const flat = text.replace(/[\r\n]+/g, "");
  j = tryParse(flat);
  if (j) return j;
  // 3) Base64-encoded key (with or without wrapping).
  const compact = text.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=_-]+$/.test(compact)) {
    j = tryParse(Buffer.from(compact, "base64").toString("utf8").trim());
    if (j) return j;
  }
  return null;
}

const key = repair(raw);
if (!key || key.type !== "service_account" || !key.private_key || !key.client_email) {
  console.log(
    "::error::GCP_SA_KEY doesn't look like a Google service-account key. " +
      "Re-run scripts/setup-github-deploy.sh in Cloud Shell and paste the new value into the GCP_SA_KEY secret."
  );
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify(key), { mode: 0o600 });
console.log(`Service-account key OK for ${key.client_email}`);
