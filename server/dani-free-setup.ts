// Install tools only. Starting the router can refresh/probe upstreams, so setup must never start it as a side effect.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { installStandaloneEngine, standaloneAssetFor, standalonePlatformKey } from './engine-standalone.ts';
import { OPENCODE_STANDALONE } from './drivers/acp/opencode-release.ts';
import { DANI_FREE_KILO, DANI_FREE_PROXY } from './dani-free-releases.ts';
import type { StandaloneRelease } from './contracts.ts';
export const DANI_FREE_TOOLS = [OPENCODE_STANDALONE, DANI_FREE_KILO, DANI_FREE_PROXY] as const;
export type DaniFreeSetupState = { phase: 'not-installed' | 'installing' | 'installed' | 'failed' | 'unsupported'; message: string; modelReady: false };
let running: Promise<DaniFreeSetupState> | undefined;
let latest: DaniFreeSetupState | undefined;
export function daniFreeInstalled(baseDir = DATA_DIR, platformKey = standalonePlatformKey()): boolean {
  return DANI_FREE_TOOLS.every(release => {
    const asset = standaloneAssetFor(release, platformKey);
    if (!asset) return false;
    const path = join(baseDir, 'tools', 'standalone', release.engine, release.version, asset.executable);
    try { return existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === asset.executableSha256; } catch { return false; }
  });
}
export function daniFreeSetupStatus(): DaniFreeSetupState {
  if (!DANI_FREE_TOOLS.every(release => standaloneAssetFor(release))) return { phase: 'unsupported', message: 'Dani Free automatic setup is not yet available for this platform.', modelReady: false };
  if (running) return { phase: 'installing', message: 'Installing Dani Free. This can take several minutes.', modelReady: false };
  if (daniFreeInstalled()) return { phase: 'installed', message: 'Dani Free tools installed. Live model connection is not verified yet.', modelReady: false };
  return latest?.phase === 'failed' ? latest : { phase: 'not-installed', message: 'Install Dani Free to set up its required tools on this computer.', modelReady: false };
}
export function installDaniFreeTools(install: (release: StandaloneRelease) => Promise<unknown> = installStandaloneEngine): Promise<DaniFreeSetupState> {
  if (running) return running;
  if (install === installStandaloneEngine && daniFreeSetupStatus().phase === 'unsupported') return Promise.resolve(daniFreeSetupStatus());
  running = Promise.resolve().then(async () => {
    try {
      for (const release of DANI_FREE_TOOLS) await install(release);
      return latest = { phase: 'installed', message: 'Dani Free tools installed. Live model connection is not verified yet.', modelReady: false };
    } catch (error) {
      console.error('[dani-free-setup]', error);
      return latest = { phase: 'failed', message: 'Dani Free setup could not finish. Your existing tools and data are preserved. Try again.', modelReady: false };
    }
  }).finally(() => { running = undefined; });
  return running;
}
