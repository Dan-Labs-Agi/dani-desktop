import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";
import beforePack from "./before-pack.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const { LinuxTargetHelper } = builderRequire("app-builder-lib/out/targets/LinuxTargetHelper.js");

test("the Linux package preserves product identity while using the sandbox-safe install root", async () => {
  const appInfo = {
    productName: "Dani Bot",
    sanitizedProductName: "Dani Bot",
    productFilename: "danibot",
    id: "com.danibot.app",
    description: "Fixture",
  };
  const packager = {
    appInfo,
    config: {},
    executableName: "danibot",
    fileAssociations: [],
    info: { metadata: { desktopName: "danibot", name: "danibot" } },
    platformSpecificBuildOptions: {},
    expandMacro: (value) => value,
  };

  await beforePack({ electronPlatformName: "linux", packager });
  assert.equal(appInfo.productName, "Dani Bot");
  assert.equal(appInfo.sanitizedProductName, "danibot");
  const entry = await LinuxTargetHelper.prototype.computeDesktopEntry.call(
    { packager, getDescription: () => appInfo.description },
    { category: "Utility", desktop: { entry: { Name: "Dani Bot" } } },
  );
  assert.match(entry, /Exec=\/opt\/danibot\/danibot %U/);
  assert.match(entry, /Name=Dani Bot/);
  assert.doesNotMatch(entry, /--no-sandbox|--disable-gpu-sandbox/);
});

test("the package hooks and policy use the same Linux install root", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(read("electron-builder.yml"), /beforePack: .\/scripts\/before-pack\.mjs/);
  assert.match(read("build/linux-after-install.sh"), /APP_ROOT="\/opt\/danibot"/);
  assert.match(read("build/linux-danibot-browser.apparmor"), /\/opt\/danibot\/\{/);
  assert.match(read("build/linux-after-remove.sh"), /"\/opt\/danibot\/danibot" "\/opt\/Dani Bot\/danibot"/);
  assert.match(read("scripts/verify-linux-package.mjs"), /path\.join\(extracted, "opt", "danibot"\)/);
});
