// Keep display/data/signing identity intact. Only Linux package payload roots
// use the existing executable name, so Chromium's SUID path has no whitespace.
export default async function beforePack(context) {
  if (context.electronPlatformName !== "linux") return;
  const info = context.packager.appInfo;
  if (info.productName !== "Dani Bot" || context.packager.executableName !== "danibot") {
    throw new Error("Unexpected Linux product identity; review the install-root mapping");
  }
  info.sanitizedProductName = "danibot";
}
