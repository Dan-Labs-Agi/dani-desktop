import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { validateReleaseVersion } from "./release-version.mjs";

const run = promisify(execFile);

export async function validateReleaseArtifacts(directory, version) {
  validateReleaseVersion(version);
  const root = resolve(directory);
  const inventory = new Map();
  async function collect(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await collect(file);
      else {
        if (!entry.isFile()) throw new Error(`Release asset is not a regular file: ${file}`);
        if (inventory.has(entry.name)) throw new Error(`Duplicate release asset basename: ${entry.name}`);
        inventory.set(entry.name, { file, size: (await stat(file)).size });
      }
    }
  }
  await collect(root);
  const packages = {
    "latest.yml": { required: [`DaniBot-${version}-setup.exe`], allowed: [`DaniBot-${version}-setup.exe`, `DaniBot-${version}-win-x64.zip`] },
    "latest-mac.yml": { required: [`DaniBot-${version}-arm64.dmg`, `DaniBot-${version}-arm64.zip`, `DaniBot-${version}-x64.dmg`, `DaniBot-${version}-x64.zip`] },
    "latest-linux.yml": { required: [`DaniBot-${version}-x86_64.AppImage`], allowed: [`DaniBot-${version}-x86_64.AppImage`, `DaniBot-${version}-amd64.deb`] },
  };
  const installers = [
    ...Object.values(packages).flatMap((spec) => spec.required),
    `DaniBot-${version}-win-x64.zip`, `DaniBot-${version}-amd64.deb`,
  ];
  for (const name of installers) {
    if (!inventory.get(name)?.size) throw new Error(`Missing or empty release asset: ${name}`);
  }
  const hashes = new Map();
  async function digest(name) {
    if (!hashes.has(name)) {
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(inventory.get(name).file)) hash.update(chunk);
      hashes.set(name, hash.digest("base64"));
    }
    return hashes.get(name);
  }
  for (const [name, spec] of Object.entries(packages)) {
    const asset = inventory.get(name);
    if (!asset?.size) throw new Error(`Missing update feed: ${name}`);
    const feed = parse(await readFile(asset.file, "utf8"));
    if (feed?.version !== version) throw new Error(`${name}: expected version ${version}`);
    if (!Array.isArray(feed.files) || feed.files.length === 0) throw new Error(`${name}: missing files`);
    const allowed = spec.allowed ?? spec.required;
    const seen = new Set();
    for (const entry of feed.files) {
      if (!entry || typeof entry.url !== "string" || basename(entry.url) !== entry.url || !allowed.includes(entry.url)) {
        throw new Error(`${name}: invalid platform artifact URL ${entry?.url}`);
      }
      if (seen.has(entry.url)) throw new Error(`${name}: duplicate file ${entry.url}`);
      seen.add(entry.url);
      const target = inventory.get(entry.url);
      if (!target || dirname(target.file) !== dirname(asset.file)) throw new Error(`${name}: referenced file does not exist beside feed: ${entry.url}`);
      if (!Number.isSafeInteger(entry.size) || entry.size !== target.size || entry.size <= 0) throw new Error(`${name}: size mismatch for ${entry.url}`);
      if (entry.sha512 !== await digest(entry.url)) throw new Error(`${name}: SHA512 mismatch for ${entry.url}`);
    }
    for (const required of spec.required) {
      if (!seen.has(required)) throw new Error(`${name}: required update file missing: ${required}`);
    }
    if (!seen.has(feed.path) || feed.sha512 !== await digest(feed.path)) throw new Error(`${name}: legacy path/SHA512 mismatch`);
  }
  for (const name of installers.filter((file) => file.endsWith(".zip"))) {
    const archive = inventory.get(name).file;
    // Windows includes bsdtar; macOS and Ubuntu include unzip. Archive members
    // are checked without writing or executing them.
    const { stdout } = await run(process.platform === "win32" ? "tar.exe" : "unzip", process.platform === "win32" ? ["-tf", archive] : ["-Z1", archive], { maxBuffer: 32 * 1024 * 1024 });
    const entries = stdout.split(/\r?\n/);
    const mac = entries.includes("Dani Bot.app/Contents/MacOS/Dani Bot");
    const windows = entries.includes("Dani Bot.exe");
    const expectedWindows = name.endsWith("-win-x64.zip");
    if (expectedWindows ? !windows || mac : !mac || windows) {
      throw new Error(`${name}: archive does not contain the expected ${expectedWindows ? "Windows" : "macOS"} application`);
    }
    await new Promise((resolve, reject) => {
      const windows = process.platform === "win32";
      const child = spawn(windows ? "tar.exe" : "unzip", windows ? ["-xOf", archive] : ["-tqq", archive], {
        stdio: ["ignore", "ignore", "pipe"], windowsHide: true, timeout: 120_000,
      });
      let detail = "";
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        if (detail.length < 8192) detail += chunk.slice(0, 8192 - detail.length);
      });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${name}: archive integrity check failed (${code}): ${detail.trim()}`)));
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [directory, version] = process.argv.slice(2);
  if (!directory || !version) throw new Error("Expected artifact directory and stable version");
  await validateReleaseArtifacts(directory, version);
  console.log(`Validated ${version} installers, ZIP platforms, update-feed sizes and SHA512 checksums`);
}
