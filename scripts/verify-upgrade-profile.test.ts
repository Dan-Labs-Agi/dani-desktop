import { describe, it, expect } from "vitest";
import { profileProbeEvidence, PROFILE_PROBE_MARKER } from "../electron/profile-probe-evidence.mjs";
import { verifyUpgradeProfile } from "./verify-upgrade-profile.mjs";
const line = (data: unknown) => "DANI_PROFILE_EVIDENCE " + JSON.stringify(data);
describe("direct upgrade profile evidence", () => {
  it("does not touch files unless explicitly enabled", () => {
    expect(profileProbeEvidence({ enabled: false, userData: "/x", read: () => { throw Error("must not read"); } })).toBeNull();
  });
  it("reads only the synthetic marker from the actual supplied runtime path", () => {
    const files: string[] = [];
    expect(profileProbeEvidence({ enabled: true, userData: "/real/Dani Bot", read: (p: string) => { files.push(p); return PROFILE_PROBE_MARKER; } })).toEqual({ userData: "/real/Dani Bot", priorProfileMarkerRead: true });
    expect(files).toEqual(["/real/Dani Bot/probe-marker.txt"]);
  });
  it.each(["", "wrong", null])("does not accept missing or wrong marker %s", (content) => {
    const e = profileProbeEvidence({ enabled: true, userData: "/real/Dani Bot", read: () => { if (content === null) throw Error("absent"); return content; } });
    expect(verifyUpgradeProfile("/real/Dani Bot", line(e)).ok).toBe(false);
  });
  it.each(["", "DANI_PROFILE_EVIDENCE bad", line({ userData: "/real/dani-desktop", priorProfileMarkerRead: true }), line({ userData: "/real/Dani Bot", priorProfileMarkerRead: false })])("fails closed on unproven use", (text) => {
    expect(verifyUpgradeProfile("/real/Dani Bot", text).ok).toBe(false);
  });
  it.each(["C:\\Users\\runner\\AppData\\Roaming\\Dani Bot", "/Users/runner/Library/Application Support/Dani Bot"])("accepts runtime path plus actual marker read: %s", (userData) => {
    expect(verifyUpgradeProfile(userData + "\n", line({ userData, priorProfileMarkerRead: true })).ok).toBe(true);
  });
  it("rejects duplicate evidence rather than choosing one", () => {
    const text = line({ userData: "/real/Dani Bot", priorProfileMarkerRead: true });
    expect(verifyUpgradeProfile("/real/Dani Bot", text + "\n" + text).ok).toBe(false);
  });
});
