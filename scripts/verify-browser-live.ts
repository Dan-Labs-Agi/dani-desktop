// Actual browser + actual BrowserPanel, always in a disposable fixture HOME.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";
import { createServer } from "vite";
import { closeRecoveryBrowsers } from "./testing/browser-recovery-smoke.ts";


const binaryPath = process.env.OMB_VERIFY_BROWSER_BINARY;
const executablePath = process.env.OMB_VERIFY_BROWSER_CHROME;
if (!binaryPath || !executablePath) throw new Error("Set OMB_VERIFY_BROWSER_BINARY and OMB_VERIFY_BROWSER_CHROME to explicit installed binaries.");
const fixture = await launchVerificationServer(process.env, undefined, undefined, { binaryPath, executablePath });
const evidenceDir = process.env.OMB_VERIFY_BROWSER_EVIDENCE_DIR;
if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
const artifact = (name: string) => evidenceDir ? resolve(evidenceDir, name) : fixture.info.logPath.replace(/\.log$/, `-${name}`);
let ui: MountedPreview | undefined;
try {
  await runControlOmb(["new-bot", "--name", "Pepper", "--url", fixture.info.url]);
  const { bots } = await (await fetch(`${fixture.info.url}/api/bots`)).json() as any;
  await fetch(`${fixture.info.url}/api/bots/${bots[0].id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ browser: true }) });
  const preview = await createServer({
    server: { host: "127.0.0.1", port: 0, hmr: false, watch: null,
      proxy: { "/api": fixture.info.url, "/.well-known/danibot/environment": fixture.info.url } },
    plugins: [{ name: "frozen-browser-fixture", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (path === "/__browser-test-page") {
          res.setHeader("content-type", "text/html");
          res.end(readFileSync(new URL("./testing/browser-test-page.html", import.meta.url), "utf8"));
        } else if (path === "/__browser-preview.html") {
          void server.transformIndexHtml(path, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/testing/browser-preview.tsx"></script></body></html>')
            .then((html) => { res.setHeader("content-type", "text/html"); res.end(html); }).catch(next);
        } else next();
      });
    } }],
  });
  ui = { previewUrl: "", close: () => preview.close() };
  await preview.listen();
  assert(preview.resolvedUrls?.local[0]);
  ui = { previewUrl: new URL("/__browser-preview.html", preview.resolvedUrls.local[0]).href, close: () => preview.close() };
  const configured = await fetch(`${fixture.info.url}/api/config`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ features: { browser: true }, browserEngine: { egress: { allow: [new URL(ui.previewUrl).host] } } }),
  });
  assert(configured.ok, `Fixture browser configuration refused: ${configured.status} ${await configured.text()}`);
  console.log(JSON.stringify({ ...fixture.info, botId: bots[0].id, previewSession: `bot-${bots[0].id}`, previewUrl: ui.previewUrl, testPage: new URL("/__browser-test-page", ui.previewUrl).href }, null, 2));
  if (process.argv.includes("--recovery")) {
    const { verifyBrowserRecovery } = await import("./testing/browser-recovery-smoke.ts");
    await verifyBrowserRecovery({ binaryPath, executablePath, dataDir: fixture.info.dataDir,
      previewSession: `bot-${bots[0].id}`, previewUrl: ui.previewUrl, testPage: new URL("/__browser-test-page", ui.previewUrl).href,
      screenshotPath: artifact("browser.png"), evidencePath: artifact("recovery.json"),
      failPreviewSetup: process.argv.includes("--fail-preview-setup") });
  } else await parkUntilSignal();
} finally {
  try { await ui?.close(); }
  finally {
    try { await closeRecoveryBrowsers(binaryPath, fixture.info.dataDir, artifact("native-cleanup.json")); }
    finally {
      await fixture.close();
      if (evidenceDir) {
        copyFileSync(fixture.info.logPath, join(evidenceDir, "server.log"));
        writeFileSync(join(evidenceDir, "cleanup.json"), JSON.stringify({ ...fixture.info, dataDirRemoved: !existsSync(fixture.info.dataDir) }, null, 2) + "\n");
        assert(!existsSync(fixture.info.dataDir), "Owned fixture data was not removed");
      }
    }
  }
}
