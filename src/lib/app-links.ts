export const APP_NAME = "Dani Bot";
/** This app's own repository and release channel. */
export const APP_REPOSITORY = "https://github.com/somdipto/dani-desktop";
/** The project this app is based on (OpenMausBot by Milind Soni, Apache 2.0). Docs and mobile downloads are still its own until Dan Lab publishes equivalents. */
export const UPSTREAM_REPOSITORY = "https://github.com/milind-soni/OpenMausBot";
export const DOCS_URL = `${UPSTREAM_REPOSITORY}/tree/main/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${UPSTREAM_REPOSITORY}/blob/main/docs/approval-levels.md`;
export const FEEDBACK_URL = "https://discord.gg/9Wb8MEpXRs";
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = `${APP_REPOSITORY}/blob/main/LICENSE`;
export const IOS_APP_STORE_URL = "https://apps.apple.com/in/app/mausbot/id6803387923";
export const ANDROID_APK_URL = `${UPSTREAM_REPOSITORY}/releases/download/android-v1.5.0/OpenMausBot.apk`;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
