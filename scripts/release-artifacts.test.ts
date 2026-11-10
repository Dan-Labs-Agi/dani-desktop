import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dani-release-artifacts-"));
  roots.push(root);
  for (const [platform, files] of Object.entries(names)) {
    const directory = join(root, `${platform}-release`);
    await mkdir(directory);
    for (const name of files) {
      await writeFile(join(directory, name), name.endsWith(".zip")
        ? zip(platform === "windows" ? "Dani Bot.exe" : "Dani Bot.app/Contents/MacOS/Dani Bot")
        : Buffer.from(name));
    }
    const entries = await Promise.all(files.filter((name) => platform !== "windows" || name.endsWith(".exe")).map(async (url) => {
      const bytes = await readFile(join(directory, url));
      return { url, size: bytes.length, sha512: createHash("sha512").update(bytes).digest("base64") };
    }));
    await writeFile(join(directory, platform === "macos" ? "latest-mac.yml" : platform === "windows" ? "latest.yml" : "latest-linux.yml"), stringify({ version, files: entries, path: entries[0]!.url, sha512: entries[0]!.sha512 }));
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
