// electron-builder beforePack hook: the packaged Dani Free proxy must be exactly
// the pinned, digest-verified binary for the target platform/arch. A staged
// directory earns no trust by existing - a source-built or hand-copied binary
// there is rejected by checksum, and a missing one fails loudly, so no package
// can ship an unverified proxy.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DANI_FREE_BINARIES, sha256 } from "./prepare-dani-free.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** electron-builder Arch enum -> our pin keys. */
const ARCH_NAMES = Object.freeze({ 1: "x64", 3: "arm64" });

export function verifyDaniFreeStaged({ resourcesDir = join(ROOT, "resources"), platform, arch, pins = DANI_FREE_BINARIES }) {
  const key = `${platform}-${arch}`;
  const pin = pins[key];
  if (!pin) throw new Error(`Dani Free: no pinned binary for ${key}; refusing to package for an unpinned target.`);
  const binary = join(resourcesDir, "dani-free", platform, arch, platform === "win32" ? "dani-free.exe" : "dani-free");
  if (!existsSync(binary)) {
    throw new Error(`Dani Free: ${binary} is missing. Stage it with scripts/prepare-dani-free.mjs (digest-verified) before packaging.`);
  }
  const actual = sha256(readFileSync(binary));
  if (actual !== pin.sha256) {
    throw new Error(`Dani Free: staged ${key} binary sha256 ${actual} does not match pinned ${pin.sha256}; refusing to package an unverified proxy.`);
  }
  return true;
}

export default async function beforePack(context) {
  const arch = ARCH_NAMES[context.arch] ?? String(context.arch);
  verifyDaniFreeStaged({ platform: context.electronPlatformName, arch });
}
