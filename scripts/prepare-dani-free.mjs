// Stage the pinned Dani Free proxy binaries for the desktop package, mirroring
// prepare-cloudflared.mjs: pinned artifact, digest-verified before use and on
// every reuse. The proxy's own updater stays disabled (DANI_FREE_ENGINE_AUTOUPDATE=0).
//
// The artifact lives in the private somdipto/Dani-Free-proxy repo, so the download
// needs a GitHub token with actions:read on that repo in GH_TOKEN (or GITHUB_TOKEN).
// The token is used for the artifact request only and never printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DANI_FREE_ARTIFACT = Object.freeze(JSON.parse(readFileSync(join(ROOT, "scripts", "dani-free-proxy-artifact.json"), "utf8")));

/** Per-binary digests from dani-dex scripts/dani-free-binaries.sha256, artifact-locked. */
export const DANI_FREE_BINARIES = Object.freeze({
  "darwin-arm64": Object.freeze({ file: "dani-free-darwin-arm64", sha256: "12347b8acc2b690e67541641fee1ee7d1ec91d702e34f5da64cbc2f922adcd9f" }),
  "darwin-x64": Object.freeze({ file: "dani-free-darwin-x64", sha256: "d12ea4d5d0f66ec716fc51d6989398796411b97868fe17a235811a5cc0e0bbd6" }),
  "linux-arm64": Object.freeze({ file: "dani-free-linux-arm64", sha256: "0780ae5710a88c46ccab8bac5d33304eea04b3a154a6124cd4520bf78928e73b" }),
  "linux-x64": Object.freeze({ file: "dani-free-linux-x64", sha256: "a82f98348c4c38b98b9b13b104545d882b3dd489e2026218e9bf562730ee2239" }),
  "win32-x64": Object.freeze({ file: "dani-free-windows-x64.exe", sha256: "ab37b6ecea1e418f5c8784afe6492ce9e588f3188d72cc64d055929638704856" }),
});

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Where the packaged app looks: <resources>/dani-free/<platform>/<arch>/dani-free[.exe]. */
export function stagedBinaryPath(resourcesDir, platform, arch) {
  return join(resourcesDir, "dani-free", platform, arch, platform === "win32" ? "dani-free.exe" : "dani-free");
}

/** Public, non-expiring release the pins above were published as; every file is digest-verified before it is staged. */
export const DANI_FREE_RELEASE_TAG = "v0.1.1-dani-dex.1";
export function releaseAssetUrl(file, tag = DANI_FREE_RELEASE_TAG) {
  return `https://github.com/${DANI_FREE_ARTIFACT.repository}/releases/download/${tag}/${file}`;
}

export function artifactZipUrl(artifact = DANI_FREE_ARTIFACT) {
  return `https://api.github.com/repos/${artifact.repository}/actions/artifacts/${artifact.artifactId}/zip`;
}

async function downloadPinnedZip(token) {
  const response = await fetch(artifactZipUrl(), {
    redirect: "follow",
    signal: AbortSignal.timeout(300_000),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`could not download dani-free-binaries artifact: HTTP ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const digest = sha256(zip);
  if (digest !== DANI_FREE_ARTIFACT.zipSha256) {
    throw new Error(`dani-free-binaries artifact digest mismatch: got ${digest}, pinned ${DANI_FREE_ARTIFACT.zipSha256}`);
  }
  return zip;
}

/** Unzip with the system unzipper into a fresh temp dir; returns the dir. */
function unzip(zip, work) {
  const zipPath = join(work, "artifact.zip");
  writeFileSync(zipPath, zip);
  const out = join(work, "out");
  mkdirSync(out);
  const result = spawnSync("unzip", ["-o", "-q", zipPath, "-d", out], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr.trim()}`);
  return out;
}

/** Verify one binary against its pin and stage it executable. */
export function stageBinary(sourceFile, targetPlatform, arch, resourcesDir) {
  const pin = DANI_FREE_BINARIES[`${targetPlatform}-${arch}`];
  if (!pin) throw new Error(`no Dani Free pin for ${targetPlatform}-${arch}`);
  const bytes = readFileSync(sourceFile);
  const digest = sha256(bytes);
  if (digest !== pin.sha256) throw new Error(`${pin.file} digest mismatch: got ${digest}, pinned ${pin.sha256}`);
  const target = stagedBinaryPath(resourcesDir, targetPlatform, arch);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, target);
  chmodSync(target, 0o755);
  return target;
}

async function main() {
  const currentOnly = process.argv.includes("--current");
  const resourcesDir = join(ROOT, "resources");
  const platformFlag = process.argv.indexOf("--platform");
  const onlyPlatform = platformFlag > 0 ? process.argv[platformFlag + 1] : null;
  const wanted = currentOnly
    ? [`${process.platform}-${process.arch}`]
    : Object.keys(DANI_FREE_BINARIES).filter((key) => !onlyPlatform || key.startsWith(`${onlyPlatform}-`));
  if (!wanted.length) throw new Error(`no Dani Free pin for platform ${onlyPlatform}`);
  const missing = wanted.filter((key) => {
    const [platform, arch] = key.split("-");
    const target = stagedBinaryPath(resourcesDir, platform, arch);
    return !existsSync(target) || sha256(readFileSync(target)) !== DANI_FREE_BINARIES[key].sha256;
  });
  if (!missing.length) { console.log("dani-free binaries staged and digest-verified"); return; }
  // Preferred: the public release, which needs no token and does not expire like a workflow artifact.
  const stillMissing = [];
  for (const key of missing) {
    const [platform, arch] = key.split("-");
    const pin = DANI_FREE_BINARIES[key];
    try {
      const response = await fetch(releaseAssetUrl(pin.file), { redirect: "follow", signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const work = mkdtempSync(join(tmpdir(), "dani-free-"));
      try {
        const file = join(work, pin.file);
        writeFileSync(file, Buffer.from(await response.arrayBuffer()));
        console.log(`staged ${stageBinary(file, platform, arch, resourcesDir)} (public release ${DANI_FREE_RELEASE_TAG})`);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(`public release download for ${pin.file} failed (${error instanceof Error ? error.message : error}); trying the pinned artifact`);
      stillMissing.push(key);
    }
  }
  missing.splice(0, missing.length, ...stillMissing);
  if (!missing.length) return;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(`dani-free binaries missing for ${missing.join(", ")} and no GH_TOKEN/GITHUB_TOKEN is set; the artifact lives in the private ${DANI_FREE_ARTIFACT.repository} repo`);
  }
  const work = mkdtempSync(join(tmpdir(), "dani-free-"));
  try {
    const out = unzip(await downloadPinnedZip(token), work);
    for (const key of missing) {
      const [platform, arch] = key.split("-");
      const staged = stageBinary(join(out, DANI_FREE_BINARIES[key].file), platform, arch, resourcesDir);
      console.log(`staged ${staged}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
