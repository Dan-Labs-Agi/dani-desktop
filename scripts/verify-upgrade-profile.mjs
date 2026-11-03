// Verify direct runtime evidence, never a guessed Electron default or an
// unchanged old directory. An older artifact without instrumentation fails
// unverified and must be rebuilt before this probe can certify profile use.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function verifyUpgradeProfile(oldPath, text) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith("DANI_PROFILE_EVIDENCE "));
  if (lines.length !== 1) return { ok: false, reason: "missing or ambiguous runtime profile evidence" };
  let evidence;
  try { evidence = JSON.parse(lines[0].slice("DANI_PROFILE_EVIDENCE ".length)); } catch { return { ok: false, reason: "malformed runtime profile evidence" }; }
  const normalize = (p) => p.trim().replaceAll("\\", "/").replace(/\/$/, "");
  const old = normalize(oldPath);
  const actual = typeof evidence.userData === "string" ? normalize(evidence.userData) : null;
  // Windows drive-letter paths are case-insensitive; mac paths are not folded.
  const same = actual !== null && (/^[A-Za-z]:/.test(old) ? actual.toLowerCase() === old.toLowerCase() : actual === old);
  if (!same) return { ok: false, reason: "candidate uses a different profile directory; compatibility unverified", userData: evidence.userData };
  if (evidence.priorProfileMarkerRead !== true) return { ok: false, reason: "candidate did not read the planted prior-profile marker", userData: evidence.userData };
  return { ok: true, userData: evidence.userData, priorProfileMarkerRead: true, scope: "prior profile path and synthetic marker read only; not credential decryption or full migration" };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [, , oldFile, logFile, output] = process.argv;
  const result = verifyUpgradeProfile(readFileSync(oldFile, "utf8"), readFileSync(logFile, "utf8"));
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
