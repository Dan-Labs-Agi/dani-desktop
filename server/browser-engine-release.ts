// Official release executables hashed against GitHub's asset metadata on 2026-11-12.
// Keep Docker's version aligned and qualify packaged binaries on each native target.
export const AGENT_BROWSER_VERSION = "0.41.2";

export interface AgentBrowserReleaseAsset {
  /** `<platform>-<arch>`; Linux adds `-musl` on Alpine-style systems. */
  target: string;
  asset: string;
  sha256: string;
  bytes: number;
  /** A reviewed platform-specific vendor revision; other assets use the upstream version. */
  version?: string;
  /** Exact release URL for a reviewed vendor build, never a mutable latest URL. */
  url?: string;
}

const RELEASES = new Map<string, AgentBrowserReleaseAsset>([
  [
    "darwin-arm64",
    { target: "darwin-arm64", asset: "agent-browser-darwin-arm64", sha256: "19680f06cf87d0095c318a2e80bea6b71523d95d3b651cd18d81885cd182477a", bytes: 16068000 },
  ],
  [
    "darwin-x64",
    { target: "darwin-x64", asset: "agent-browser-darwin-x64", sha256: "fc55608c2222650e6e0d0154f9edebd203b63bf853b85d22240bfbddbb006ea1", bytes: 17761648 },
  ],
  [
    "linux-arm64",
    { target: "linux-arm64", asset: "agent-browser-linux-arm64", sha256: "00d291f45e1c4d527b3aa08c70c54c7c3030fde0794f8d4575aaa3ca1680f728", bytes: 16108464 },
  ],
  [
    "linux-musl-arm64",
    { target: "linux-musl-arm64", asset: "agent-browser-linux-musl-arm64", sha256: "730a5168153e27ad1243ebe960157e69de0f24531fbbac9a040856a491bf491f", bytes: 15924440 },
  ],
  [
    "linux-musl-x64",
    { target: "linux-musl-x64", asset: "agent-browser-linux-musl-x64", sha256: "5d452d57772330fe4cef9b7aeb5e7137890dde20bbb65e82b990e0bc0b35d9cd", bytes: 18434688 },
  ],
  [
    "linux-x64",
    { target: "linux-x64", asset: "agent-browser-linux-x64", sha256: "c4351f3802ffa5254d8c69f20a52e2fcf56925c6016fcf4203db25a07d811379", bytes: 18626776 },
  ],
  [
    "win32-x64",
    {
      // Upstream 0.37.0 still lacks vercel-labs/agent-browser#1781's Windows cold-start fix.
      // Retain the native-verified revision until its replacement is tested.
      target: "win32-x64", version: "0.36.0-omb.2",
      asset: "agent-browser-win32-x64-0.36.0-omb.2.exe",
      url: "https://github.com/Dan-Labs-Agi/dani-desktop/releases/download/browser-engine-v0.36.0-omb.2/agent-browser-win32-x64-0.36.0-omb.2.exe",
      sha256: "12f50ad4a6631459fe1eed8fa86efb11e1e50f7d6d6811770c8fd40ff69fbc3f", bytes: 13806080,
    },
  ],
]);

export function agentBrowserReleaseUrl(asset: AgentBrowserReleaseAsset): string {
  return asset.url ?? `https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/${asset.asset}`;
}

export function agentBrowserReleaseVersion(asset: AgentBrowserReleaseAsset | null): string {
  return asset?.version ?? AGENT_BROWSER_VERSION;
}

/** The asset for this machine, or null where Vercel publishes none. */
export function resolveAgentBrowserReleaseAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = false,
): AgentBrowserReleaseAsset | null {
  const key = platform === "linux" && musl ? `linux-musl-${arch}` : `${platform}-${arch}`;
  return RELEASES.get(key) ?? null;
}
