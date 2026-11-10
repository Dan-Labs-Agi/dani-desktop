import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

const script = fileURLToPath(new URL("./regenerate-mac-feed.mjs", import.meta.url));
const roots: string[] = [];
const digest = (bytes: Buffer) => createHash("sha512").update(bytes).digest("base64");
const releaseDate = "2020-01-01T00:00:00.000Z";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dani-mac-feed-"));
  roots.push(root);
  const directory = join(root, "release");
  await mkdir(directory);
  const names = ["DaniBot-arm64.zip", "DaniBot-x64.dmg"];
  const files = await Promise.all(names.map(async (url) => {
    const bytes = Buffer.from(`before stapling: ${url}`);
    await writeFile(join(directory, url), bytes);
    // This field order is emitted by the real release fixtures.
    return { url, size: bytes.length, sha512: digest(bytes) };
  }));
  const feed = { version: "0.1.140", files, path: files[0]!.url, sha512: files[0]!.sha512, releaseDate, releaseNotes: "Preserve release metadata" };
  const path = join(directory, "latest-mac.yml");
  await writeFile(path, stringify(feed));
  return { root, directory, path, feed };
}

function run(root: string) {
  return spawnSync(process.execPath, [script, "release/latest-mac.yml"], { cwd: root, encoding: "utf8", timeout: 10_000 });
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("macOS feed regeneration CLI", () => {
  it("accepts url/size/sha512 field order and rehashes postprocessed bytes without changing artifact order", async () => {
    const fixtureData = await fixture();
    const { root, directory, path, feed } = fixtureData;
    const replacement = [
      Buffer.alloc(feed.files[0]!.size, 0x61), // Hash changes even when the size does not.
      Buffer.from("postprocessed DMG with stapled notarization ticket"),
    ];
    for (const [index, bytes] of replacement.entries()) await writeFile(join(directory, feed.files[index]!.url), bytes);
    // The legacy fallback is recomputed from the first entry, not trusted.
    feed.path = feed.files[1]!.url;
    feed.sha512 = "stale legacy checksum";
    await writeFile(path, stringify(feed));
    const started = Date.now();
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    const updated = parse(await readFile(path, "utf8"));
    expect(updated.files).toEqual(feed.files.map((entry, index) => ({ ...entry, size: replacement[index]!.length, sha512: digest(replacement[index]!) })));
    expect(updated.path).toBe(feed.files[0]!.url);
    expect(updated.sha512).toBe(digest(replacement[0]!));
    expect(updated.version).toBe(feed.version);
    expect(updated.releaseNotes).toBe(feed.releaseNotes);
    expect(Date.parse(updated.releaseDate)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(updated.releaseDate)).toBeLessThanOrEqual(Date.now());
    expect(result.stdout).toContain("verified against 2 artifacts");
  });

  it("preserves the original feed when a later referenced artifact is missing", async () => {
    const { root, directory, path, feed } = await fixture();
    await writeFile(join(directory, feed.files[0]!.url), "changed after notarization");
    await rm(join(directory, feed.files[1]!.url));
    const original = await readFile(path, "utf8");
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("parses quoted filenames and entries whose URL is not the first key", async () => {
    const { root, directory, path, feed } = await fixture();
    const url = "Dani Bot-arm64.zip";
    const bytes = Buffer.from("quoted artifact after postprocessing");
    await writeFile(join(directory, url), bytes);
    const original = stringify({
      ...feed,
      files: [{ sha512: "stale", size: 1, url }, feed.files[1]],
    });
    await writeFile(path, original);
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    const updated = parse(await readFile(path, "utf8"));
    expect(updated.files[0]).toEqual({ sha512: digest(bytes), size: bytes.length, url });
    expect(updated.path).toBe(url);
    expect(updated.sha512).toBe(digest(bytes));
  });

  it.each([
    "../outside.zip", "/outside.zip", "https://example.invalid/outside.zip", "file:///outside.zip",
    "C:\\outside.zip", "..\\outside.zip", "//example.invalid/outside.zip",
  ])("rejects unsafe artifact reference %s without changing the feed", async (url) => {
    const { root, path, feed } = await fixture();
    feed.files[1]!.url = url;
    const original = stringify(feed);
    await writeFile(path, original);
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid.*(?:url|reference|path)/i);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("rejects a symlink escaping the release directory without changing the feed", async () => {
    const { root, directory, path, feed } = await fixture();
    const outside = join(root, "outside.zip");
    await writeFile(outside, "outside release directory");
    await rm(join(directory, feed.files[1]!.url));
    await symlink(outside, join(directory, feed.files[1]!.url));
    const original = await readFile(path, "utf8");
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/(?:outside|regular file|symlink)/i);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it.each([
    "version: 0.1.140\nfiles: []\n", "version: 0.1.140\nfiles: nope\n", "files: [null]\n", "files: [\n",
  ])("rejects malformed feed structure without changing the feed: %s", async (original) => {
    const { root, path } = await fixture();
    await writeFile(path, original);
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(await readFile(path, "utf8")).toBe(original);
  });
});
