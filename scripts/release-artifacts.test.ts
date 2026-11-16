import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { validateReleaseArtifacts } from "./release-artifacts.mjs";

const version = "0.1.140";
const roots: string[] = [];
const names = {
  windows: [`DaniBot-${version}-setup.exe`, `DaniBot-${version}-win-x64.zip`],
  macos: [`DaniBot-${version}-arm64.dmg`, `DaniBot-${version}-arm64.zip`, `DaniBot-${version}-x64.dmg`, `DaniBot-${version}-x64.zip`],
  linux: [`DaniBot-${version}-x86_64.AppImage`, `DaniBot-${version}-amd64.deb`],
};
const aliases = {
  "DaniBot-setup.exe": names.windows[0]!,
  "DaniBot-Windows-Portable.zip": names.windows[1]!,
  "DaniBot-Silicon.dmg": names.macos[0]!,
  "DaniBot-Silicon-Portable.zip": names.macos[1]!,
  "DaniBot-Intel.dmg": names.macos[2]!,
  "DaniBot-Intel-Portable.zip": names.macos[3]!,
  "DaniBot.AppImage": names.linux[0]!,
  "danibot-amd64.deb": names.linux[1]!,
};

function zip(entry: string, payload = Buffer.alloc(0)): Buffer {
  const name = Buffer.from(entry);
  const checksum = crc32(payload);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + payload.length, 16);
  return Buffer.concat([local, name, payload, central, name, end]);
}

async function fixture(buildVersion = version) {
  const root = await mkdtemp(join(tmpdir(), "dani-release-artifacts-"));
  roots.push(root);
  for (const [platform, platformFiles] of Object.entries(names)) {
    const files = platformFiles.map((name) => name.replace(version, buildVersion));
    const directory = join(root, `${platform}-release`);
    await mkdir(directory);
    for (const name of files) {
      await writeFile(join(directory, name), name.endsWith(".zip")
        ? zip(platform === "windows" ? "Dani Bot.exe" : "Dani Bot.app/Contents/MacOS/Dani Bot")
        : Buffer.from(name));
      if (name.endsWith(".exe") || platform === "macos") {
        await writeFile(join(directory, `${name}.blockmap`), Buffer.from("blockmap fixture"));
      }
      for (const [alias, source] of Object.entries(aliases)) {
        if (source.replace(version, buildVersion) === name) await copyFile(join(directory, name), join(directory, alias));
      }
    }
    const entries = await Promise.all(files.filter((name) => platform !== "windows" || name.endsWith(".exe")).map(async (url) => {
      const bytes = await readFile(join(directory, url));
      return { url, size: bytes.length, sha512: createHash("sha512").update(bytes).digest("base64") };
    }));
    await writeFile(join(directory, platform === "macos" ? "latest-mac.yml" : platform === "windows" ? "latest.yml" : "latest-linux.yml"), stringify({ version: buildVersion, files: entries, path: entries[0]!.url, sha512: entries[0]!.sha512 }));
  }
  return root;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function editFeed(root: string, change: (feed: { version: string; files: Array<{ url: string; size: number; sha512: string }>; path: string; sha512: string }) => void) {
  const file = join(root, "macos-release", "latest-mac.yml");
  const feed = parse(await readFile(file, "utf8"));
  change(feed);
  await writeFile(file, stringify(feed));
}

describe("release artifact and update-feed contract", () => {
  it("accepts complete native packages with distinct Windows and Intel Mac ZIP names", async () => {
    await expect(validateReleaseArtifacts(await fixture(), version)).resolves.toBeUndefined();
  });

  it.each(Object.keys(aliases))("rejects missing or mismatched stable download %s", async (alias) => {
    const root = await fixture();
    const platform = alias.includes("setup") || alias.includes("Windows") ? "windows" : alias.includes("Intel") || alias.includes("Silicon") ? "macos" : "linux";
    const file = join(root, `${platform}-release`, alias);
    await writeFile(file, "not the verified versioned installer");
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/alias|stable|checksum|sha512/i);
    await rm(file);
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/missing|alias|stable/i);
  });

  it("rejects missing updater blockmaps", async () => {
    const root = await fixture();
    await rm(join(root, "windows-release", `${names.windows[0]}.blockmap`));
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/blockmap|missing/i);
  });

  it("rejects basename collisions before flattening artifacts", async () => {
    const root = await fixture();
    await copyFile(join(root, "windows-release", names.windows[1]!), join(root, "windows-release", names.macos[3]!));
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/duplicate.*basename/i);
  });

  it("rejects a hash mismatch even though the named file exists", async () => {
    const root = await fixture();
    await editFeed(root, (feed) => { feed.files[1]!.sha512 = "incorrect"; });
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/sha512|checksum|hash/i);
  });

  it("rejects missing Intel ZIPs and DMG-only Mac update feeds", async () => {
    const missing = await fixture();
    await rm(join(missing, "macos-release", names.macos[3]!));
    await expect(validateReleaseArtifacts(missing, version)).rejects.toThrow(/missing|exist/i);
    const dmgOnly = await fixture();
    await editFeed(dmgOnly, (feed) => { feed.files = feed.files.filter((file) => !file.url.endsWith(".zip")); });
    await expect(validateReleaseArtifacts(dmgOnly, version)).rejects.toThrow(/zip|required/i);
  });

  it("rejects a Windows ZIP disguised as the Intel Mac update ZIP", async () => {
    const root = await fixture();
    const bytes = zip("Dani Bot.exe");
    await writeFile(join(root, "macos-release", names.macos[3]!), bytes);
    await editFeed(root, (feed) => {
      const entry = feed.files.find((file) => file.url === names.macos[3])!;
      entry.size = bytes.length;
      entry.sha512 = createHash("sha512").update(bytes).digest("base64");
    });
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/macOS|Mac.*ZIP|archive/i);
  });

  it("rejects corrupted portable Windows ZIP contents even when no updater feed references that ZIP", async () => {
    const root = await fixture();
    const name = "Dani Bot.exe";
    const archive = zip(name, Buffer.from("Portable executable contract fixture."));
    archive[30 + Buffer.byteLength(name)]! ^= 1;
    await writeFile(join(root, "windows-release", names.windows[1]!), archive);
    await expect(validateReleaseArtifacts(root, version)).rejects.toThrow(/archive.*integrity|CRC|corrupt|invalid/i);
  });

  it("rejects a feed reference whose file is absent and cross-platform entries", async () => {
    const missing = await fixture();
    await editFeed(missing, (feed) => { feed.files.push({ url: `DaniBot-${version}-missing.zip`, size: 1, sha512: "missing" }); });
    await expect(validateReleaseArtifacts(missing, version)).rejects.toThrow();
    const wrongPlatform = await fixture();
    await editFeed(wrongPlatform, (feed) => { feed.files.push({ url: names.windows[1]!, size: 1, sha512: "wrong" }); });
    await expect(validateReleaseArtifacts(wrongPlatform, version)).rejects.toThrow();
  });

  it("rejects feed version, size, legacy checksum, and external path mismatches", async () => {
    for (const change of [
      (feed: { version: string }) => { feed.version = "0.1.139"; },
      (feed: { files: Array<{ size: number }> }) => { feed.files[0]!.size += 1; },
      (feed: { sha512: string }) => { feed.sha512 = "incorrect"; },
      (feed: { files: Array<{ url: string }> }) => { feed.files[0]!.url = "https://example.com/DaniBot.zip"; },
    ]) {
      const root = await fixture();
      await editFeed(root, change);
      await expect(validateReleaseArtifacts(root, version)).rejects.toThrow();
    }
  });
});

describe("branch build integrity without publication eligibility", () => {
  const localVersion = "0.1.140-local.3";
  const buildOptions = { buildVersion: true };
  const execute = promisify(execFile);
  const verifier = fileURLToPath(new URL("./release-artifacts.mjs", import.meta.url));

  it("accepts complete local-version artifacts only in explicit build mode", async () => {
    const root = await fixture(localVersion);
    await expect(validateReleaseArtifacts(root, localVersion, buildOptions)).resolves.toBeUndefined();
    await expect(validateReleaseArtifacts(root, localVersion)).rejects.toThrow(/stable/);
    await expect(execute(process.execPath, [verifier, root, localVersion, "--build-version"])).resolves.toMatchObject({ stderr: "" });
    await expect(execute(process.execPath, [verifier, root, localVersion])).rejects.toMatchObject({ stderr: expect.stringMatching(/stable/) });
  });

  it("also accepts a stable version in explicit branch build mode", async () => {
    await expect(validateReleaseArtifacts(await fixture(), version, buildOptions)).resolves.toBeUndefined();
  });

  it.each(["0.1", "v0.1.140", "01.1.140", "0.1.140-local", "0.1.140-local.01", "0.1.140-local.-1", "0.1.140-beta.3", "0.1.140+build", "9007199254740992.0.0-local.3"])("rejects malformed or unsupported build version %s", async (invalid) => {
    await expect(validateReleaseArtifacts(await fixture(invalid), invalid, buildOptions)).rejects.toThrow(/version/);
  });

  it.each(["feed-version", "size", "hash", "legacy-hash", "platform", "missing-artifact", "blockmap", "alias", "missing-alias", "archive"] as const)("still rejects local-build %s integrity failures", async (fault) => {
    const root = await fixture(localVersion);
    const localName = (name: string) => name.replace(version, localVersion);
    if (fault === "feed-version") await editFeed(root, (feed) => { feed.version = version; });
    if (fault === "size") await editFeed(root, (feed) => { feed.files[0]!.size += 1; });
    if (fault === "hash") await editFeed(root, (feed) => { feed.files[0]!.sha512 = "incorrect"; });
    if (fault === "legacy-hash") await editFeed(root, (feed) => { feed.sha512 = "incorrect"; });
    if (fault === "platform") await editFeed(root, (feed) => { feed.files[0]!.url = localName(names.windows[0]!); });
    if (fault === "missing-artifact") await rm(join(root, "macos-release", localName(names.macos[3]!)));
    if (fault === "blockmap") await rm(join(root, "windows-release", `${localName(names.windows[0]!)}.blockmap`));
    if (fault === "alias") {
      const file = join(root, "macos-release", "DaniBot-Intel.dmg");
      const bytes = await readFile(file);
      bytes[0]! ^= 1;
      await writeFile(file, bytes);
    }
    if (fault === "missing-alias") await rm(join(root, "macos-release", "DaniBot-Intel.dmg"));
    if (fault === "archive") await writeFile(join(root, "windows-release", localName(names.windows[1]!)), zip("Dani Bot.app/Contents/MacOS/Dani Bot"));
    const failures = {
      "feed-version": /expected version/,
      size: /size mismatch/,
      hash: /SHA512 mismatch/,
      "legacy-hash": /legacy path\/SHA512 mismatch/,
      platform: /invalid platform artifact URL/,
      "missing-artifact": /Missing or empty release asset/,
      blockmap: /Missing or empty release asset.*blockmap/,
      alias: /Stable download alias does not match/,
      "missing-alias": /Missing or empty stable download alias/,
      archive: /expected Windows application/,
    };
    await expect(validateReleaseArtifacts(root, localVersion, buildOptions)).rejects.toThrow(failures[fault]);
  });

  it("rejects unknown CLI flags rather than weakening publication validation", async () => {
    await expect(execute(process.execPath, [verifier, await fixture(), version, "--build-verison"])).rejects.toMatchObject({ stderr: expect.stringMatching(/option|argument|flag/i) });
  });

  it.skipIf(process.platform === "win32").each([
    ["push", "refs/heads/main", localVersion, false, true],
    ["push", "refs/heads/prod", localVersion, false, true],
    ["push", "refs/heads/main", localVersion, true, false],
    ["push", "refs/heads/prod", localVersion, true, false],
    ["push", "refs/tags/v0.1.140-local.3", localVersion, false, false],
    ["workflow_dispatch", "refs/heads/main", localVersion, false, false],
    ["push", "refs/heads/feature", localVersion, false, false],
    ["push", "refs/tags/v0.1.140", version, false, true],
    ["workflow_dispatch", "refs/heads/main", version, false, true],
  ] as const)("executes the collected-artifact workflow for %s %s %s (corrupt=%s)", async (event, ref, buildVersion, corrupt, accepted) => {
    const root = await fixture(buildVersion);
    if (corrupt) await editFeed(root, (feed) => { feed.files[0]!.sha512 = "incorrect"; });
    const workspace = await mkdtemp(join(tmpdir(), "dani-release-workflow-"));
    roots.push(workspace);
    await mkdir(join(workspace, "scripts"));
    await copyFile(verifier, join(workspace, "scripts", "release-artifacts.mjs"));
    await copyFile(new URL("./release-version.mjs", import.meta.url), join(workspace, "scripts", "release-version.mjs"));
    await symlink(fileURLToPath(new URL("../node_modules", import.meta.url)), join(workspace, "node_modules"), "dir");
    await symlink(root, join(workspace, "release-assets"), "dir");
    const workflow = parse(await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    const step = workflow.jobs["verify-artifacts"].steps.find((candidate: { run?: string }) => candidate.run?.includes("scripts/release-artifacts.mjs"));
    const result = execute("bash", ["-e", "-o", "pipefail", "-c", step.run], {
      cwd: workspace,
      env: { ...process.env, VERSION: buildVersion, GITHUB_EVENT_NAME: event, GITHUB_REF: ref },
    });
    if (accepted) await expect(result).resolves.toMatchObject({ stderr: "" });
    else await expect(result).rejects.toMatchObject({ stderr: expect.stringMatching(corrupt ? /SHA512 mismatch/ : /stable/) });
  });
});
