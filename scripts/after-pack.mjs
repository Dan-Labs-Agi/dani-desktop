import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Arch } from "electron-builder";
import { parseManagedRuntimeManifest } from "../server/managed-runtime.ts";
import { LICENSE_FILES } from "./cua-linux-release.mjs";
import {
  executableTarget,
  verifyCloudflaredExecutable,
} from "./prepare-cloudflared.mjs";

async function requireRealDirectory(directory, mode = 0o755) {
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Package resource must be a real directory: ${directory}`);
  }
  if (mode !== undefined) await chmod(directory, mode);
}

async function requireRegularFile(file, mode) {
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Package resource must be a regular file: ${file}`);
  }
  if (mode !== undefined) await chmod(file, mode);
  return details;
}

async function validateManagedRuntimes(resources, context) {
  const arch = typeof context.arch === "number" ? Arch[context.arch] : undefined;
  const target = `${context.electronPlatformName}-${arch}`;
  if (!["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"].includes(target)) {
    throw new Error(
      `Unsupported electron-builder runtime target: ${context.electronPlatformName}, arch=${context.arch}. ` +
      "afterPack requires the numeric target arch from electron-builder; the build host is not the app target.",
    );
  }
  const root = path.join(resources, "managed-runtimes");
  for (const kind of ["hermes", "opencode"]) {
    try {
      const manifestPath = path.join(root, "manifests", `${kind}-${target}.manifest.json`);
      await requireRegularFile(manifestPath);
      const manifest = parseManagedRuntimeManifest(JSON.parse(await readFile(manifestPath, "utf8")));
      if (manifest.name !== `${kind}-runtime-payload` || manifest.target !== target) {
        throw new Error(
          `manifest identity mismatch in ${manifestPath}: expected ${kind}-runtime-payload/${target}, ` +
          `received ${manifest.name}/${manifest.target}`,
        );
      }
      const archive = path.join(root, "archives", `${manifest.name}-${target}.${manifest.format}`);
      const details = await requireRegularFile(archive);
      if (details.size !== manifest.archiveSize) {
        throw new Error(
          `archive size mismatch in ${archive}: expected ${manifest.archiveSize}, received ${details.size}`,
        );
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(archive)) hash.update(chunk);
      const digest = hash.digest("hex");
      if (digest !== manifest.archiveSha256) {
        throw new Error(
          `archive SHA-256 mismatch in ${archive}: expected ${manifest.archiveSha256}, received ${digest}`,
        );
      }
    } catch (error) {
      throw new Error(
        `Packaged ${kind} runtime for ${target} is invalid: ${error.message}. ` +
        `Restage with sh scripts/stage-runtimes.sh ${target} before packaging.`,
        { cause: error },
      );
    }
  }
}

async function validateCloudflared(resources, platform, required) {
  const root = path.join(resources, "cloudflared");
  try {
    await lstat(root);
  } catch (error) {
    // Unit fixtures for the older CUA-only hook do not carry every packaged
    // resource. A real electron-builder context must fail closed because its
    // copier only warns when an extraResources `from` path is missing.
    if (error?.code === "ENOENT" && !required) return;
    throw error;
  }

  const unixMode = platform === "win32" ? undefined : 0o755;
  await requireRealDirectory(root, unixMode);
  const executable = path.join(root, platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (JSON.stringify(await readdir(root)) !== JSON.stringify([path.basename(executable)])) {
    throw new Error(`Unexpected entries in packaged cloudflared resource: ${root}`);
  }
  await requireRegularFile(executable, unixMode);
  const target = executableTarget(await readFile(executable));
  const allowed = {
    darwin: new Set(["darwin-arm64", "darwin-x64"]),
    linux: new Set(["linux-x64"]),
    win32: new Set(["win32-x64"]),
  }[platform];
  if (!allowed?.has(target)) {
    throw new Error(`Packaged ${platform} app contains the wrong cloudflared target: ${target}`);
  }
  verifyCloudflaredExecutable(executable, target);

  const licenses = path.join(resources, "licenses");
  await requireRealDirectory(licenses, unixMode);
  await requireRegularFile(
    path.join(licenses, "cloudflared-LICENSE.txt"),
    platform === "win32" ? undefined : 0o644,
  );
  await requireRegularFile(
    path.join(licenses, "cloudflared-README.md"),
    platform === "win32" ? undefined : 0o644,
  );
}

// electron-builder normalizes copied resource directories to 0775. That is
// unsafe for a root-owned executable path after DEB/AppImage installation, so
// repair and revalidate the exact tree after resources are copied and before
// either artifact target is assembled.
export default async function afterPack(context) {
  const resources = context.packager?.getResourcesDir?.(context.appOutDir) ?? (
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, "Dani Bot.app", "Contents", "Resources")
      : path.join(context.appOutDir, "resources")
  );
  await validateManagedRuntimes(resources, context);
  await validateCloudflared(resources, context.electronPlatformName, Boolean(context.packager));

  if (context.electronPlatformName !== "linux") return;

  const cuaRoot = path.join(resources, "cua-linux-x64");
  const licenses = path.join(cuaRoot, "licenses");
  for (const directory of [context.appOutDir, resources, cuaRoot, licenses]) {
    await requireRealDirectory(directory);
  }
  for (const executable of ["cua-driver", "cua-cursor-theme"]) {
    await requireRegularFile(path.join(cuaRoot, executable), 0o755);
  }
  await requireRegularFile(path.join(cuaRoot, "release.json"), 0o644);
  for (const license of LICENSE_FILES) {
    await requireRegularFile(path.join(licenses, license), 0o644);
  }
}
