import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { stableUpdaterFixture } from "./fixtures/stable-updater.mjs";
import { updateErrorMessage } from "./update-errors.mjs";

const fixture = vi.hoisted(() => ({ updater: null, app: null }));
vi.mock("electron", () => ({
  app: {
    get isPackaged() { return true; },
    getVersion: () => fixture.app.getVersion(),
    getPath: (name) => fixture.app.getPath(name),
  },
  clipboard: { writeText() {} }, ipcMain: { handle() {} },
}));
vi.mock("node:module", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, createRequire: (url) => String(url).endsWith("/updater.mjs")
    ? () => ({ autoUpdater: fixture.updater })
    : original.createRequire(url) };
});

afterEach(() => { vi.restoreAllMocks(); });

async function configured(t, options) {
  const h = await stableUpdaterFixture(options);
  t.onTestFinished(() => h.close());
  fixture.updater = h.updater;
  fixture.app = h.electronApp;
  vi.resetModules();
  const { startUpdater } = await import("./updater.mjs");
  // Startup scheduling is not under test; no coordinator background jobs may download or install.
  vi.spyOn(globalThis, "setTimeout").mockReturnValue({ unref() {} });
  vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref() {} });
  startUpdater();
  vi.restoreAllMocks();
  h.updater.removeAllListeners();
  h.updater.on("error", () => {});
  h.updater.autoInstallOnAppQuit = false;
  return h;
}

it("stable policy overrides local prerelease inference without allowing downgrades", async (t) => {
  const h = await configured(t);
  expect(h.updater.channel).toBe("latest");
  expect(h.updater.allowPrerelease).toBe(false);
  expect(h.updater.allowDowngrade).toBe(false);
});

for (const latest of ["0.1.140", "0.1.141"]) {
  it(`real GitHub stable feed upgrades 0.1.140-local.2 to ${latest} while ignoring prerelease entries`, async (t) => {
    const h = await configured(t, { latest });
    const result = await h.updater.checkForUpdates();
    expect(result.isUpdateAvailable).toBe(true);
    expect(result.updateInfo.version).toBe(latest);
    expect(h.requests).toContain("/api/v3/repos/Dan-Labs-Agi/dani-desktop/releases/latest");
    expect(h.requests.some((path) => /(?:local|beta|alpha)(?:-linux.*)?\.yml$/.test(path))).toBe(false);
    expect(h.requests.some((path) => path.includes("0.2.0-beta.1"))).toBe(false);
  });
}

it("real GitHub stable feed also advances an installed production version", async (t) => {
  const h = await configured(t, { current: "0.1.140", latest: "0.1.141" });
  const result = await h.updater.checkForUpdates();
  expect(result.isUpdateAvailable).toBe(true);
  expect(result.updateInfo.version).toBe("0.1.141");
});

it("real stable checker refuses an older stable release", async (t) => {
  const h = await configured(t, { latest: "0.1.139" });
  const result = await h.updater.checkForUpdates();
  expect(result.isUpdateAvailable).toBe(false);
  expect(result.updateInfo.version).toBe("0.1.139");
});

for (const failure of ["missing", "malformed", "empty"]) {
  it(`real GitHub checker keeps ${failure} published feed failures as errors, never up-to-date`, async (t) => {
    const h = await configured(t, { [failure]: true });
    let unavailable = 0;
    h.updater.on("update-not-available", () => { unavailable++; });
    await expect(h.updater.checkForUpdates()).rejects.toThrow();
    expect(unavailable).toBe(0);
  });
}

it("loopback smoke downloads real vendored bytes and enforces SHA-512 before accepting an update", async (t) => {
  const h = await configured(t);
  expect((await h.updater.checkForUpdates()).isUpdateAvailable).toBe(true);
  const files = await h.updater.downloadUpdate();
  expect(files).toHaveLength(1);
  expect(files[0].startsWith(`${h.directory}/`)).toBe(true);
  expect(readFileSync(files[0])).toEqual(h.bytes);
  expect(h.requests.some((path) => path.endsWith(".AppImage"))).toBe(true);
});

it("loopback smoke rejects corrupted bytes through the real vendored checksum validator", async (t) => {
  const h = await configured(t, { corrupt: true });
  let downloaded = 0;
  h.updater.on("update-downloaded", () => { downloaded++; });
  await h.updater.checkForUpdates();
  await expect(h.updater.downloadUpdate()).rejects.toThrow(/sha512 checksum mismatch/i);
  expect(downloaded).toBe(0);
});

it("a first published stable release is a truthful prerequisite, not an up-to-date result", () => {
  const error = Object.assign(new Error("No published versions on GitHub"), { code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS" });
  expect(updateErrorMessage(error)).toMatch(/first.*published.*stable release/i);
  expect(updateErrorMessage(error)).toMatch(/official release page/i);
  expect(updateErrorMessage(new Error("No published versions on GitHub"))).toBe(updateErrorMessage(error));
});
