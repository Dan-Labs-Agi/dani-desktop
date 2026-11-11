import { describe, expect, it } from "vitest";
import { nextReleaseVersion, validateReleaseVersion } from "./release-version.mjs";

describe("stable release versions", () => {
  it("graduates the current local build without skipping its stable version", () => {
    expect(nextReleaseVersion("0.1.140-local.2", "patch")).toBe("0.1.140");
    expect(nextReleaseVersion("0.1.140-local.2", "custom", "0.1.140")).toBe("0.1.140");
    expect(nextReleaseVersion("0.1.140", "patch")).toBe("0.1.141");
    expect(nextReleaseVersion("0.1.141", "patch")).toBe("0.1.142");
    expect(nextReleaseVersion("0.1.140-local.2", "minor")).toBe("0.2.0");
  });

  it.each(["0.1.139", "0.1.140-local.3", "0.1.141-beta.1", "01.1.141", "0.1", "v0.1.141", "0.1.141+build", "9007199254740992.0.0"])("rejects invalid or older custom release %s", (requested) => {
    expect(() => nextReleaseVersion("0.1.140-local.2", "custom", requested)).toThrow();
  });

  it("rejects equal stable versions, unknown bumps, and non-local current prereleases", () => {
    expect(() => nextReleaseVersion("0.1.140", "custom", "0.1.140")).toThrow(/newer/);
    expect(() => nextReleaseVersion("0.1.140-beta.1", "patch")).toThrow(/local|stable/);
    expect(() => nextReleaseVersion("0.1.140", "major")).toThrow(/bump/);
  });

  it("requires a stable release input and an exact matching version tag", () => {
    expect(validateReleaseVersion("0.1.140", "refs/tags/v0.1.140")).toBe("0.1.140");
    expect(validateReleaseVersion("0.1.140", "refs/heads/main")).toBe("0.1.140");
    expect(() => validateReleaseVersion("0.1.140-local.2", "refs/heads/main")).toThrow(/stable/);
    expect(() => validateReleaseVersion("0.1.140", "refs/tags/v0.1.139")).toThrow(/tag/);
    expect(() => validateReleaseVersion("0.1.140", "refs/tags/v0.1.140-extra")).toThrow(/tag/);
  });
});
