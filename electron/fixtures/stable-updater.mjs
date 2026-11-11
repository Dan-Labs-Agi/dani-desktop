// Only Electron's transport/app boundary is adapted; provider, semver, download and digest checks are vendored code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "Dan-Labs-Agi";
const REPO = "dani-desktop";
const BASE = `/${OWNER}/${REPO}/releases`;
const bytes = Buffer.from("isolated updater checksum fixture\n");
const arch = process.env.TEST_UPDATER_ARCH || process.arch;
const channelFile = `latest-linux${arch === "x64" ? "" : `-${arch}`}.yml`;
const digest = createHash("sha512").update(bytes).digest("base64");

export async function stableUpdaterFixture({ current = "0.1.140-local.2", latest = "0.1.141", missing = false, malformed = false, corrupt = false, empty = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dani-stable-updater-"));
  const requests = [];
  const server = createServer((incoming, response) => {
    const path = new URL(incoming.url, "http://127.0.0.1").pathname;
    requests.push(path);
    const reply = (status, content, type = "text/plain") => {
      response.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(content) });
      response.end(content);
    };
    if (path === `${BASE}.atom`) {
      const entries = empty ? "" : ["0.2.0-beta.1", latest, "0.1.142-local.3"].map((version) =>
        `<entry><title>${version}</title><link href="https://github.com/${OWNER}/${REPO}/releases/tag/v${version}"/><content>Fixture</content></entry>`).join("");
      return reply(200, `<feed>${entries}</feed>`, "application/atom+xml");
    }
    if (path === `/api/v3/repos/${OWNER}/${REPO}/releases/latest`) {
      return reply(200, JSON.stringify({ tag_name: `v${latest}` }), "application/json");
    }
    if (path === `${BASE}/download/v${latest}/${channelFile}`) {
      if (missing) return reply(404, "No published channel file");
      const info = malformed ? "version: [unterminated" : JSON.stringify({ version: latest, files: [{ url: `DaniBot-${latest}.AppImage`, sha512: digest, size: bytes.length }] });
      return reply(200, info, "text/yaml");
    }
    if (path === `${BASE}/download/v${latest}/DaniBot-${latest}.AppImage`) {
      return reply(200, corrupt ? Buffer.from("tampered update bytes") : bytes, "application/octet-stream");
    }
    return reply(404, "Unexpected fixture route");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const electronApp = {
    isPackaged: true,
    getVersion: () => current,
    getName: () => "Dani updater fixture",
    getPath: () => directory,
    whenReady: async () => {},
    quit: () => assert.fail("fixture must never quit or install"),
    relaunch: () => assert.fail("fixture must never relaunch"),
  };
  const electron = {
    app: electronApp,
    autoUpdater: new EventEmitter(),
    session: { fromPartition: () => ({}) },
    net: { request(options) {
      // No URL rewriting or forwarding: every provider URL must already target this isolated server.
      assert.equal(options.protocol, "http:");
      assert.equal(options.hostname, "127.0.0.1");
      assert.equal(Number(options.port), port);
      return request({ ...options, agent: false });
    } },
  };
  const originalLoad = Module._load;
  Module._load = (name, ...args) => name === "electron" ? electron : originalLoad(name, ...args);
  const originalAppImage = process.env.APPIMAGE;
  process.env.APPIMAGE = join(directory, "running.AppImage");
  writeFileSync(process.env.APPIMAGE, "old app, never replaced");
  const { AppUpdater, AppImageUpdater } = createRequire(import.meta.url)("../vendor/electron-updater.cjs");
  const transport = new AppUpdater();
  const config = join(directory, "app-update.yml");
  writeFileSync(config, "updaterCacheDirName: fixture-cache\n");
  const updater = new AppImageUpdater(null, {
    version: current, name: "fixture", isPackaged: true,
    userDataPath: join(directory, "data"), baseCachePath: directory,
    appUpdateConfigPath: config, whenReady: async () => {},
    quit: electronApp.quit, relaunch: electronApp.relaunch,
    onQuit: () => assert.fail("fixture must not register an install-on-quit handler"),
  });
  updater.httpExecutor = transport.httpExecutor;
  updater._testOnlyOptions = { platform: "linux" };
  updater.disableDifferentialDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.setFeedURL({ provider: "github", owner: OWNER, repo: REPO, host: `127.0.0.1:${port}`, protocol: "http" });
  return {
    updater, requests, directory, electronApp, bytes,
    async close() {
      Module._load = originalLoad;
      if (originalAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = originalAppImage;
      try {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        assert.equal(readFileSync(join(directory, "running.AppImage"), "utf8"), "old app, never replaced");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
