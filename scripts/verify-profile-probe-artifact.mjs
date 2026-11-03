// Refuse an old candidate before interpreting runtime evidence from it.
import { readFileSync } from "node:fs";
const bytes = readFileSync(process.env.PROBE_ASAR);
const expected = readFileSync(new URL("../electron/profile-probe-evidence.mjs", import.meta.url));
if (!bytes.includes(expected) || !bytes.includes(Buffer.from('profileProbeEvidence({ enabled: true, userData: app.getPath("userData") })'))) {
  throw new Error("candidate lacks exact profile-probe implementation or runtime path hook");
}
console.log("candidate contains exact opt-in profile evidence helper and runtime path hook");
