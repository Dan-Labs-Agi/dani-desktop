import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import beforePack, { verifyDaniFreeStaged } from "./verify-dani-free-packaged.mjs";
import { DANI_FREE_BINARIES } from "./prepare-dani-free.mjs";

const dirs = [];
function fixture() {
  const resourcesDir = mkdtempSync(join(tmpdir(), "dani-free-verify-"));
  dirs.push(resourcesDir);
  return resourcesDir;
}
function stage(resourcesDir, platform, arch, bytes) {
  const dir = join(resourcesDir, "dani-free", platform, arch);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, platform === "win32" ? "dani-free.exe" : "dani-free");
  writeFileSync(file, bytes);
  return file;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

describe("verify-dani-free-packaged", () => {
  it("rejects a missing staged binary", () => {
    expect(() => verifyDaniFreeStaged({ resourcesDir: fixture(), platform: "linux", arch: "x64" })).toThrow(/missing/);
  });

  it("rejects a staged binary whose digest is not the pinned one - the source-built dev binary case", () => {
    const resourcesDir = fixture();
    stage(resourcesDir, "linux", "x64", "source-built dev binary, not the pinned artifact");
    expect(() => verifyDaniFreeStaged({ resourcesDir, platform: "linux", arch: "x64" })).toThrow(/does not match pinned/);
  });

  it("accepts a staged binary matching its pin", () => {
    const resourcesDir = fixture();
    const bytes = Buffer.from("the exact pinned bytes");
    stage(resourcesDir, "linux", "x64", bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const pins = { "linux-x64": Object.freeze({ file: "dani-free-linux-x64", sha256 }) };
    expect(verifyDaniFreeStaged({ resourcesDir, platform: "linux", arch: "x64", pins })).toBe(true);
  });

  it("rejects targets with no pin", () => {
    expect(() => verifyDaniFreeStaged({ resourcesDir: fixture(), platform: "linux", arch: "ia32" })).toThrow(/no pinned binary/);
  });

  it("the beforePack hook maps electron-builder's arch enum and enforces verification", async () => {
    await expect(beforePack({ electronPlatformName: "linux", arch: 1 })).rejects.toThrow(/Dani Free/);
    await expect(beforePack({ electronPlatformName: "darwin", arch: 3 })).rejects.toThrow(/Dani Free/);
  });

  it("pins exist for every packaged target", () => {
    for (const key of ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]) {
      expect(DANI_FREE_BINARIES[key].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
