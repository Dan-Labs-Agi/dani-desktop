// Opt-in diagnostics for synthetic CI profiles only. Never reads credentials
// or settings, changes the profile path, or creates/migrates files.
import { readFileSync } from "node:fs";
import path from "node:path";
export const PROFILE_PROBE_MARKER = "synthetic upgrade marker - not user data\n";
export function profileProbeEvidence({ enabled, userData, read = readFileSync }) {
  if (!enabled) return null;
  let priorProfileMarkerRead = false;
  try { priorProfileMarkerRead = read(path.join(userData, "probe-marker.txt"), "utf8") === PROFILE_PROBE_MARKER; } catch { /* absent or unreadable is unproven */ }
  return { userData, priorProfileMarkerRead };
}
