import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Arch } from "electron-builder";
import { afterEach, describe, expect, it } from "vitest";
import afterPack from "./after-pack.mjs";
import { LICENSE_FILES } from "./cua-linux-release.mjs";

const temporaryDirectories = [];

function stageRuntime(resources, kind, target, overrides = {}) {
  const root = path.join(resources, "managed-runtimes");
  const manifestPath = path.join(root, "manifests", `${kind}-${target}.manifest.json`);
  const archivePath = path.join(root, "archives", `${kind}-runtime-payload-${target}.tar.gz`);
  const bytes = Buffer.from(`${kind} archive fixture for ${target}`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, bytes);
  const manifest = {
    manifestVersion: 1,
    name: `${kind}-runtime-payload`,
    target,
    version: "fixture",
    upstreamCommit: "a".repeat(40),
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    archiveSize: bytes.length,
    unpackedSize: 1,
    format: "tar.gz",
    executableRelPath: target.startsWith("win32-") ? "bin/agent.cmd" : "bin/agent",
    probe: {
      argv: [target.startsWith("win32-") ? "probe/run.cmd" : "probe/run.sh"],
      protocol: "acp-jsonrpc-stdio: initialize",
      expectedVersion: "fixture",
      expectedAgentName: kind,
    },
    noticeRelPath: "NOTICE",
    sbomRelPath: "SBOM.cdx.json",
    degradations: ["fixture"],
    ...overrides,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { manifestPath, archivePath };
}

function packageFixture(platform, arch, stagedTarget = `${platform}-${Arch[arch]}`) {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "omb-after-pack-target-"));
  temporaryDirectories.push(appOutDir);
  const resources = platform === "darwin"
    ? path.join(appOutDir, "Dani Bot.app", "Contents", "Resources")
    : path.join(appOutDir, "resources");
  for (const kind of ["hermes", "opencode"]) stageRuntime(resources, kind, stagedTarget);
  return { resources, context: { electronPlatformName: platform, arch, appOutDir } };
}

function fixture(platform = "linux") {
  const { context, resources } = packageFixture(platform, Arch.x64);
  const { appOutDir } = context;
  const cua = path.join(resources, "cua-linux-x64");
  const licenses = path.join(cua, "licenses");
  fs.mkdirSync(licenses, { recursive: true, mode: 0o775 });
  for (const directory of [appOutDir, resources, cua, licenses]) fs.chmodSync(directory, 0o775);
  for (const name of ["cua-driver", "cua-cursor-theme", "release.json"]) {
    fs.writeFileSync(path.join(cua, name), "fixture", { mode: 0o664 });
    fs.chmodSync(path.join(cua, name), 0o664);
  }
  for (const name of LICENSE_FILES) {
    fs.writeFileSync(path.join(licenses, name), "fixture", { mode: 0o664 });
    fs.chmodSync(path.join(licenses, name), 0o664);
  }
  return { context, appOutDir, resources, cua, licenses };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("packaged managed runtime target and integrity", () => {
  it.each([
    ["darwin", Arch.x64],
    ["darwin", Arch.arm64],
    ["win32", Arch.x64],
    ["linux", Arch.x64],
  ])("accepts the matching %s/%s pair and archive hashes", async (platform, arch) => {
    const { context } = platform === "linux"
      ? fixture()
      : packageFixture(platform, arch);
    await expect(afterPack(context)).resolves.toBeUndefined();
  });

  it("rejects an Intel app carrying only Apple silicon payloads", async () => {
    const { resources, context } = packageFixture("darwin", Arch.x64, "darwin-arm64");
    context.packager = { getResourcesDir: () => resources };
    await expect(afterPack(context)).rejects.toThrow(
      /hermes.*darwin-x64.*hermes-darwin-x64\.manifest\.json.*stage-runtimes\.sh darwin-x64/s,
    );
  });

  it.each([
    ["hermes", "manifestPath"],
    ["hermes", "archivePath"],
    ["opencode", "manifestPath"],
    ["opencode", "archivePath"],
  ])("rejects a missing %s %s", async (kind, missing) => {
    const { resources, context } = packageFixture("darwin", Arch.x64);
    const files = stageRuntime(resources, kind, "darwin-x64");
    fs.unlinkSync(files[missing]);
    await expect(afterPack(context)).rejects.toThrow(
      new RegExp(`${kind}.*darwin-x64.*ENOENT.*stage-runtimes`, "s"),
    );
  });

  it.each([
    ["hermes", { name: "opencode-runtime-payload" }],
    ["opencode", { name: "hermes-runtime-payload" }],
    ["hermes", { target: "darwin-arm64" }],
    ["opencode", { target: "darwin-arm64" }],
  ])("rejects the wrong %s manifest identity (%j)", async (kind, overrides) => {
    const { resources, context } = packageFixture("darwin", Arch.x64);
    stageRuntime(resources, kind, "darwin-x64", overrides);
    await expect(afterPack(context)).rejects.toThrow(/manifest identity mismatch/);
  });

  it.each(["hermes", "opencode"])("rejects same-size corruption in %s", async (kind) => {
    const { resources, context } = packageFixture("darwin", Arch.x64);
    const { archivePath } = stageRuntime(resources, kind, "darwin-x64");
    const bytes = fs.readFileSync(archivePath);
    bytes[0] ^= 1;
    fs.writeFileSync(archivePath, bytes);
    await expect(afterPack(context)).rejects.toThrow(/archive SHA-256 mismatch/);
  });

  it("rejects a truncated archive before hashing", async () => {
    const { resources, context } = packageFixture("darwin", Arch.x64);
    const { archivePath } = stageRuntime(resources, "hermes", "darwin-x64");
    fs.truncateSync(archivePath, 1);
    await expect(afterPack(context)).rejects.toThrow(/archive size mismatch/);
  });

  it("rejects invalid manifest metadata using the runtime schema", async () => {
    const { resources, context } = packageFixture("darwin", Arch.x64);
    stageRuntime(resources, "hermes", "darwin-x64", { degradations: [] });
    await expect(afterPack(context)).rejects.toThrow(/darwin-x64 payloads require explicit degradations/);
  });

  it.each([undefined, Arch.universal, "x64"])("fails closed on unsupported builder arch %s", async (arch) => {
    const { context } = packageFixture("darwin", Arch.x64);
    context.arch = arch;
    await expect(afterPack(context)).rejects.toThrow(/Unsupported electron-builder runtime target/);
  });
});

describe.skipIf(process.platform === "win32")("Linux afterPack permissions", () => {
  it("repairs every packaged CUA ancestor and resource mode", async () => {
    const { context, appOutDir, resources, cua, licenses } = fixture();

    await afterPack(context);

    for (const directory of [appOutDir, resources, cua, licenses]) {
      expect(fs.lstatSync(directory).mode & 0o777).toBe(0o755);
    }
    for (const name of ["cua-driver", "cua-cursor-theme"]) {
      expect(fs.lstatSync(path.join(cua, name)).mode & 0o777).toBe(0o755);
    }
    expect(fs.lstatSync(path.join(cua, "release.json")).mode & 0o777).toBe(0o644);
    for (const name of fs.readdirSync(licenses)) {
      expect(fs.lstatSync(path.join(licenses, name)).mode & 0o777).toBe(0o644);
    }
  });

  it("fails closed when the runtime root is replaced by a symlink", async () => {
    const { context, appOutDir, cua } = fixture();
    const replacement = path.join(appOutDir, "replacement");
    fs.mkdirSync(replacement);
    fs.rmSync(cua, { recursive: true });
    fs.symlinkSync(replacement, cua, "dir");
    await expect(afterPack(context)).rejects.toThrow(
      "must be a real directory",
    );
  });

  it("fails closed when the release manifest is missing", async () => {
    const { context, cua } = fixture();
    fs.unlinkSync(path.join(cua, "release.json"));
    await expect(afterPack(context)).rejects.toThrow();
  });

  it("leaves non-Linux package modes unchanged", async () => {
    const { context, cua } = fixture("darwin");
    await afterPack(context);
    expect(fs.lstatSync(cua).mode & 0o777).toBe(0o775);
    expect(fs.lstatSync(path.join(cua, "cua-driver")).mode & 0o777).toBe(0o664);
  });
});
