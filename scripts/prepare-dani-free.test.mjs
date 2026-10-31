import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { artifactZipUrl, DANI_FREE_ARTIFACT, DANI_FREE_BINARIES, sha256, stagedBinaryPath } from "./prepare-dani-free.mjs";

describe("prepare-dani-free pins", () => {
  it("addresses the pinned artifact endpoint without embedding any credential", () => {
    expect(artifactZipUrl()).toBe(`https://api.github.com/repos/somdipto/Dani-Free-proxy/actions/artifacts/${DANI_FREE_ARTIFACT.artifactId}/zip`);
    expect(DANI_FREE_ARTIFACT.zipSha256).toMatch(/^[0-9a-f]{64}$/);
    for (const pin of Object.values(DANI_FREE_BINARIES)) expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("stages binaries at the resources layout the supervisor resolves", () => {
    expect(stagedBinaryPath("/res", "linux", "x64")).toBe(join("/res", "dani-free", "linux", "x64", "dani-free"));
    expect(stagedBinaryPath("/res", "win32", "x64")).toBe(join("/res", "dani-free", "win32", "x64", "dani-free.exe"));
  });
  it("sha256 matches node crypto", () => {
    expect(sha256(Buffer.from("abc"))).toBe(createHash("sha256").update("abc").digest("hex"));
  });
});
