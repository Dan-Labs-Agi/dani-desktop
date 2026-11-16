import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { browserProfileDirectory } from "../../server/browser-engine.ts";
import { BrowserRuntime } from "../../server/browser-runtime.ts";
import { browserProcessTree, browserProcessesRunning, type BrowserProcessTree } from "../../server/browser-processes.ts";

type FrameProof = { stream: number; seq: number; hash: string; receivedAt: number; decodedAt?: number; paintedAt?: number; suppressed?: boolean };
type PreviewFixtureWindow = typeof window & {
  fixturePaints: number;
  frameProofs: FrameProof[];
  holdNextDecode: boolean;
  heldDecode: boolean;
  releaseDecode?: () => void;
  suppressFromStream: number;
  markerGate: (stream: number, rgb: number[]) => boolean;
  fixtureSources: Array<{ source: EventSource; frames: number; url: string; events: Array<{ type: string; data: Record<string, unknown> }> }>;
};

async function previewProcessInventory(pid: number, started?: string) {
  const output = await promisify(execFile)(process.platform === "darwin" ? "/bin/ps" : "ps",
    ["-A", "-ww", "-o", "pid=,ppid=,pgid=,stat=,lstart=,args="],
    { env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 5_000, maxBuffer: 16 * 1024 * 1024 });
  const rows = output.stdout.trim().split("\n").map((line) => {
    const [pid, ppid, pgid, state, ...rest] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), state, started: rest.slice(0, 5).join(" "), command: rest.slice(5).join(" ") };
  });
  const root = rows.find((row) => row.pid === pid);
  if (started) assert.equal(root?.started, started, "Preview Chrome process identity changed before close");
  assert(root, "Cannot capture owned preview Chrome start time");
  const members = new Set([pid]);
  for (let size = 0; size !== members.size;) {
    size = members.size;
    for (const row of rows) if (members.has(row.ppid)) members.add(row.pid);
  }
  const ownGroup = rows.find((row) => row.pid === process.pid)?.pgid;
  return { at: Date.now(), root, members: rows.filter((row) => members.has(row.pid)),
    groups: rows.filter((row) => members.has(row.pid) && row.pgid === row.pid && row.pgid !== ownGroup).map((row) => row.pgid) };
}

export async function verifyBrowserRecovery(input: {
  binaryPath: string; executablePath: string; dataDir: string; previewSession: string; previewUrl: string; testPage: string;
  screenshotPath: string; evidencePath: string; failPreviewSetup?: boolean;
}) {
  const playwrightPath = process.env.OMB_VERIFY_PLAYWRIGHT;
  if (!playwrightPath) throw new Error("Set OMB_VERIFY_PLAYWRIGHT to an installed Playwright module for --recovery.");
  const { chromium } = await import(playwrightPath);
  const runtime = new BrowserRuntime();
  const session = `recovery-${randomUUID()}`;
  const env = {
    HOME: input.dataDir, USERPROFILE: input.dataDir, PATH: process.env.PATH,
    XDG_RUNTIME_DIR: "", AGENT_BROWSER_SOCKET_DIR: "", AGENT_BROWSER_NAMESPACE: "",
    AGENT_BROWSER_SESSION: session, AGENT_BROWSER_HEADLESS: "1",
    AGENT_BROWSER_EXECUTABLE_PATH: input.executablePath, AGENT_BROWSER_NO_WEBMCP: "1",
  };
  const spec = { command: input.binaryPath, args: ["mcp", "--tools", "core", "--no-webmcp"], env };
  const evidence: Record<string, unknown> = { session, binaryPath: input.binaryPath, executablePath: input.executablePath, checks: [] };
  const checks = evidence.checks as Array<Record<string, unknown>>;
  const nativeCalls: Array<Record<string, unknown>> = [];
  evidence.nativeCalls = nativeCalls;
  const viewedCalls: Array<Record<string, unknown>> = [];
  evidence.viewedCalls = viewedCalls;
  let viewedPage: any;
  const viewed = async (script: string | string[]) => {
    assert(viewedPage, "Attach only to the fixture's already open native page");
    const result = typeof script === "string" ? await viewedPage.evaluate(script) : await viewedPage.locator(script[1]).click();
    viewedCalls.push({ at: Date.now(), script, result });
    return result;
  };
  let markerNumber = 0;
  const marker = async () => {
    const id = `replacement-${++markerNumber}-${randomUUID()}`;
    const rgb = [30 + markerNumber * 19 % 190, 30 + markerNumber * 53 % 190, 30 + markerNumber * 97 % 190];
    await viewed(`(() => { let mark = document.getElementById('recovery-marker'); if (!mark) { mark = document.createElement('div'); mark.id = 'recovery-marker'; document.body.append(mark); } mark.style.cssText = 'position:fixed;top:0;left:0;width:96px;height:96px;z-index:99999;background:rgb(${rgb.join(',')});'; let label = document.getElementById('recovery-marker-label'); if (!label) { label = document.createElement('div'); label.id = 'recovery-marker-label'; document.body.append(label); } label.style.cssText = 'position:fixed;top:0;left:100px;background:white;color:black;z-index:99999;font:16px monospace;'; label.textContent = ${JSON.stringify(id)}; return label.textContent; })()`);
    return { id, rgb };
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await runtime.agentRpc(session, spec, "tools/call", { name: `agent_browser_${name}`, arguments: args }) as { isError?: boolean };
    nativeCalls.push({ at: Date.now(), name, args, result });
    assert(!result.isError, JSON.stringify(result));
    return JSON.stringify(result);
  };
  let browserServer: any;
  let browser: any;
  let page: any;
  let previewTree: BrowserProcessTree | undefined;
  let previewStarted: string | undefined;
  let previewProfile: string | undefined;
  const previewCleanup: Record<string, unknown> = {};
  const closePreview = async () => {
  try {
    try {
      if (previewTree) {
        const beforeClose = await previewProcessInventory(previewTree.daemon, previewStarted);
        for (const row of beforeClose.members) previewTree.members.set(row.pid, row.started);
        previewTree.groups = [...new Set([...previewTree.groups, ...beforeClose.groups])];
        previewCleanup.beforeClose = beforeClose;
      }
    } finally {
      if (browserServer) {
        previewCleanup.closeStartedAt = Date.now();
        await browserServer.close();
        previewCleanup.closeCompletedAt = Date.now();
      }
    }
    if (previewTree) {
      let running = true;
      const deadline = Date.now() + 10_000;
      do {
        running = await browserProcessesRunning(previewTree);
        if (!running && !existsSync(previewProfile!)) break;
        await delay(100);
      } while (Date.now() < deadline);
      previewCleanup.checkedAt = Date.now();
      previewCleanup.processesRunning = running;
      previewCleanup.profileExists = existsSync(previewProfile!);
      previewCleanup.members = [...previewTree.members];
      previewCleanup.groups = previewTree.groups;
      assert(previewCleanup.exit, "Preview Chrome exit was not observed");
      assert.equal(running, false, "Owned preview Chrome process/group survived close");
      assert.equal(previewCleanup.profileExists, false, "Owned preview Chrome temporary profile survived close");
      previewCleanup.pass = true;
    }
  } catch (error) {
    previewCleanup.pass = false;
    previewCleanup.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    try { await runtime.closeAll(); }
    finally {
      evidence.previewCleanup = previewCleanup;
      writeFileSync(input.evidencePath, JSON.stringify(evidence, null, 2) + "\n");
      writeFileSync(input.evidencePath.replace(/\.json$/, "-preview-cleanup.json"), JSON.stringify(previewCleanup, null, 2) + "\n");
    }
  }
  };
  const actions: Array<Record<string, unknown>> = [];
  evidence.actions = actions;
  try {
    browserServer = await chromium.launchServer({ executablePath: input.executablePath, headless: true,
      env: { HOME: input.dataDir, USERPROFILE: input.dataDir, PATH: process.env.PATH ?? "" } });
    const child = browserServer.process();
    assert(child.pid && child.pid > 1);
    child.once("exit", (code: number | null, signal: string | null) => { previewCleanup.exit = { at: Date.now(), code, signal }; });
    const launched = await previewProcessInventory(child.pid);
    assert.equal(launched.root.ppid, process.pid);
    assert([input.executablePath, realpathSync(input.executablePath)].some((path) => launched.root.command.startsWith(`${path} `)));
    previewProfile = child.spawnargs.find((arg: string) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
    assert(previewProfile && isAbsolute(previewProfile) && existsSync(previewProfile), "Preview Chrome profile must be captured from its actual launch arguments");
    previewStarted = launched.root.started;
    previewTree = { daemon: child.pid, members: new Map(launched.members.map((row) => [row.pid, row.started])), groups: launched.groups };
    previewCleanup.launched = { ...launched, executablePath: input.executablePath, spawnargs: child.spawnargs, profile: previewProfile, profileExists: true };
    browser = await chromium.connect(browserServer.wsEndpoint());
    if (input.failPreviewSetup) throw new Error("Injected preview setup failure before newPage");
    page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await call("open", { url: input.testPage });
    await call("fill", { selector: "#name", text: "Preserved after idle" });
    await call("eval", { script: "window.fixtureIdentity = crypto.randomUUID(); window.fixtureIdentity" });
    const identity = await call("eval", { script: "window.fixtureIdentity" });
    const idleStarted = Date.now();
    const idle = delay(65_000);
    console.log("Native form filled; waiting across the production idle boundary while testing the real preview.");

    await page.addInitScript(() => {
      const Original = window.EventSource;
      const fixture = window as PreviewFixtureWindow;
      fixture.fixtureSources = [];
      fixture.fixturePaints = 0;
      fixture.frameProofs = [];
      fixture.holdNextDecode = false;
      fixture.heldDecode = false;
      fixture.suppressFromStream = Infinity;
      const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
      const pendingFrames: Array<Promise<FrameProof>> = [];
      const bitmaps = new WeakMap<ImageBitmap, FrameProof>();
      const decode = window.createImageBitmap.bind(window);
      window.createImageBitmap = new Proxy(decode, { async apply(target, context, args) {
        const candidates = [...pendingFrames];
        const hold = fixture.holdNextDecode;
        fixture.holdNextDecode = false;
        const digest = await hash(await (args[0] as Blob).arrayBuffer());
        const proof = (await Promise.all(candidates)).findLast((frame) => frame.hash === digest);
        if (proof && proof.stream >= fixture.suppressFromStream) {
          proof.suppressed = true;
          throw new Error("Fixture suppressed replacement decode");
        }
        const bitmap = await Reflect.apply(target, context, args) as ImageBitmap;
        if (proof) { proof.decodedAt = Date.now(); bitmaps.set(bitmap, proof); }
        if (hold) {
          fixture.heldDecode = true;
          await new Promise<void>((resolve) => { fixture.releaseDecode = resolve; });
          fixture.heldDecode = false;
        }
        return bitmap;
      } });
      fixture.markerGate = (stream, rgb) => {
        const canvas = document.querySelector<HTMLCanvasElement>("[data-browser-surface] canvas");
        const pixels = canvas?.getContext("2d")?.getImageData(20, 20, 1, 1).data;
        return Boolean(pixels && rgb.every((value, index) => Math.abs(value - pixels[index]!) < 10) &&
          fixture.frameProofs.some((frame) => frame.stream >= stream && frame.paintedAt));
      };
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = new Proxy(drawImage, {
        apply(target, context: CanvasRenderingContext2D, args) {
          Reflect.apply(target, context, args);
          if (context.canvas.closest("[data-browser-surface]")) {
            fixture.fixturePaints++;
            const proof = bitmaps.get(args[0] as ImageBitmap);
            if (proof) proof.paintedAt = Date.now();
          }
        },
      });
      window.EventSource = class extends Original {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          if (new URL(String(url), window.location.href).pathname.endsWith("/browser/live")) {
            const record = { source: this, frames: 0, url: String(url), events: [] as Array<{ type: string; data: Record<string, unknown> }> };
            const stream = fixture.fixtureSources.push(record) - 1;
            this.addEventListener("frame", (event) => {
              record.frames++;
              const frame = JSON.parse((event as MessageEvent).data);
              const bytes = Uint8Array.from(atob(frame.data), (char) => char.charCodeAt(0));
              const pending = hash(bytes.buffer).then((digest) => {
                const proof = { stream, seq: frame.seq, hash: digest, receivedAt: Date.now() };
                fixture.frameProofs.push(proof);
                return proof;
              });
              pendingFrames.push(pending);
            });
            for (const type of ["ready", "control", "url", "error"]) {
              this.addEventListener(type, (event) => {
                if (event instanceof MessageEvent) record.events.push({ type, data: JSON.parse(event.data) });
              });
            }
          }
        }
      };
    });
    page.on("request", (request: any) => {
      if (request.url().endsWith("/browser/action")) actions.push(request.postDataJSON());
    });
    const painted = () => page.waitForFunction(() => (window as PreviewFixtureWindow).fixturePaints > 0, undefined, { timeout: 30_000 });
    const navigations: string[] = [];
    evidence.rendererNavigations = navigations;
    page.on("framenavigated", (frame: any) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    await page.goto(input.previewUrl);
    await painted();
    await page.getByRole("textbox", { name: "Browser address" }).fill(input.testPage);
    const navigation = page.waitForResponse((response: any) => response.url().endsWith("/browser/action") && response.request().postDataJSON()?.type === "navigate");
    await page.getByRole("textbox", { name: "Browser address" }).press("Enter");
    const navigated = await navigation;
    assert(navigated.ok(), `Preview navigation refused: ${navigated.status()} ${await navigated.text()}`);
    assert.equal(actions.filter((action) => action.type === "take").length, 1);
    assert.equal(actions.filter((action) => action.type === "navigate").length, 1);
    await page.locator('[data-pill="yours"]').waitFor({ state: "attached" });
    await painted();
    const profile = browserProfileDirectory(input.previewSession, input.dataDir);
    const devtoolsFile = join(profile, "DevToolsActivePort");
    const port = Number(readFileSync(devtoolsFile, "utf8").split("\n")[0]);
    assert(Number.isInteger(port) && port > 0 && port < 65536);
    const viewedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    viewedPage = viewedBrowser.contexts().flatMap((context: any) => context.pages()).find((target: any) => target.url() === input.testPage);
    assert(viewedPage, "The daemon's current page must be the viewed fixture URL");
    evidence.viewedAttachment = { session: input.previewSession, profile, devtoolsFile, port, url: viewedPage.url() };
    const viewedIdentity = await viewed("window.fixtureIdentity = crypto.randomUUID(); document.querySelector('#name').value = 'Viewed unsaved form'; window.fixtureIdentity");
    evidence.viewedIdentity = viewedIdentity;
    await inventoryRecoveryBrowsers(input.binaryPath, input.dataDir, "before-idle");
    const reconnect = async (scenario: string, controlling: boolean) => {
      const offset = actions.length;
      const previous = await page.evaluate(() => {
        const fixture = window as PreviewFixtureWindow;
        const last = fixture.fixtureSources.at(-1);
        if (!last) throw new Error("The real preview stream was not captured");
        last.source.dispatchEvent(new Event("error"));
        return { source: fixture.fixtureSources.length - 1, paints: fixture.fixturePaints };
      });
      await page.waitForFunction((previous: number) => (window as PreviewFixtureWindow).fixtureSources
        .slice(previous + 1).some(({ events }) => events.some((event) => event.type === "ready")), previous.source);
      const visible = await marker();
      await page.waitForFunction(({ stream, rgb }: { stream: number; rgb: number[] }) => (window as PreviewFixtureWindow).markerGate(stream, rgb), { stream: previous.source + 1, rgb: visible.rgb }, { timeout: 30_000 });
      await page.locator('[data-pill="yours"]').waitFor({ state: controlling ? "attached" : "detached" });
      const state = await page.evaluate(() => {
        const fixture = window as PreviewFixtureWindow;
        const last = fixture.fixtureSources.at(-1)!;
        return { url: last.url, frames: last.frames, paints: fixture.fixturePaints,
          pixel: Array.from(document.querySelector<HTMLCanvasElement>("[data-browser-surface] canvas")!.getContext("2d")!.getImageData(20, 20, 1, 1).data),
          proofs: fixture.frameProofs.filter((proof) => proof.stream === fixture.fixtureSources.length - 1),
          ready: last.events.find((event) => event.type === "ready")?.data,
          control: last.events.filter((event) => event.type === "control").at(-1)?.data };
      });
      assert.equal(state.control?.controlling, controlling);
      assert.equal(state.control?.held, controlling);
      assert.equal(state.control?.owned, controlling);
      assert.deepEqual(actions.slice(offset).filter((action) => action.type !== "ack" && action.type !== "resize"), []);
      await page.waitForFunction((url: string) => document.querySelector<HTMLInputElement>('input[aria-label="Browser address"]')?.value === url, input.testPage);
      const screenshot = input.screenshotPath.replace(/\.png$/, `-${scenario.replace(/[^a-z]+/g, "-")}.png`);
      await page.screenshot({ path: screenshot });
      checks.push({ scenario, pass: true, visible, previous, replacement: state, actions: actions.slice(offset), screenshot });
      console.log(`PASS: ${scenario}; replacement frame painted, ownership correct, no commands replayed.`);
    };
    await reconnect("valid human resume", true);
    const release = page.waitForResponse((response: any) => response.url().endsWith("/browser/action") && response.request().postDataJSON()?.type === "release");
    await page.getByRole("button", { name: /Hand back/ }).click();
    assert((await release).ok());
    await page.locator('[data-pill="yours"]').waitFor({ state: "detached" });
    await reconnect("explicit handback remains watch-only", false);
    evidence.framesBeforeReload = await page.evaluate(() => (window as PreviewFixtureWindow).frameProofs);
    evidence.streamsBeforeReload = await page.evaluate(() => (window as PreviewFixtureWindow).fixtureSources.map(({ source, ...record }) => ({ ...record, readyState: source.readyState })));
    await page.reload();
    await painted();
    const fresh = await page.evaluate(() => {
      const last = (window as PreviewFixtureWindow).fixtureSources.at(-1)!;
      return { url: last.url, control: last.events.filter((event) => event.type === "control").at(-1)?.data };
    });
    assert.equal(new URL(fresh.url, input.previewUrl).searchParams.has("resume"), false);
    assert.deepEqual(fresh.control, { held: false, owned: false, controlling: false });
    checks.push({ scenario: "fresh observer", pass: true, ...fresh });
    await reconnect("fresh observer reconnect remains watch-only", false);
    await page.locator("[data-browser-surface] canvas").click({ position: { x: 15, y: 15 } });
    await page.locator('[data-pill="yours"]').waitFor({ state: "attached" });
    await page.locator('[data-pill="yours"]').waitFor({ state: "detached", timeout: 15_000 });
    await reconnect("idle handback cannot be revived by resume", false);
    assert.equal(actions.filter((action) => action.type === "navigate").length, 1);
    assert.equal(actions.filter((action) => action.type === "take").length, 2);
    await page.evaluate(() => { (window as PreviewFixtureWindow).holdNextDecode = true; });
    const oldMarker = await marker();
    await page.waitForFunction(() => (window as PreviewFixtureWindow).heldDecode);
    const old = await page.evaluate(() => {
      const fixture = window as PreviewFixtureWindow;
      const source = fixture.fixtureSources.length - 1;
      fixture.suppressFromStream = source + 1;
      fixture.fixtureSources[source]!.source.dispatchEvent(new Event("error"));
      return { source, paints: fixture.fixturePaints };
    });
    await page.waitForFunction((source: number) => (window as PreviewFixtureWindow).fixtureSources.slice(source + 1)
      .some(({ events }) => events.some((event) => event.type === "ready")), old.source);
    const blockedMarker = await marker();
    await page.evaluate(() => (window as PreviewFixtureWindow).releaseDecode!());
    await page.waitForFunction((old: { source: number; paints: number }) => {
      const fixture = window as PreviewFixtureWindow;
      return fixture.fixturePaints > old.paints && fixture.frameProofs.some((proof) => proof.stream > old.source && proof.suppressed);
    }, old);
    const rejected = await page.evaluate(({ stream, rgb }: { stream: number; rgb: number[] }) => ({
      gate: (window as PreviewFixtureWindow).markerGate(stream, rgb),
      proofs: (window as PreviewFixtureWindow).frameProofs,
      paints: (window as PreviewFixtureWindow).fixturePaints,
    }), { stream: old.source + 1, rgb: blockedMarker.rgb });
    assert.equal(rejected.gate, false);
    assert(!rejected.proofs.some((proof: FrameProof) => proof.stream > old.source && proof.paintedAt));
    checks.push({ scenario: "negative control: old decode paints while replacement decode is suppressed", pass: true, old, oldMarker, blockedMarker, rejected });
    await page.screenshot({ path: input.screenshotPath.replace(/\.png$/, "-negative.png") });
    await page.evaluate(() => { (window as PreviewFixtureWindow).suppressFromStream = Infinity; });
    const recoveredMarker = await marker();
    await page.waitForFunction(({ stream, rgb }: { stream: number; rgb: number[] }) => (window as PreviewFixtureWindow).markerGate(stream, rgb), { stream: old.source + 1, rgb: recoveredMarker.rgb });
    checks.push({ scenario: "replacement decode restored", pass: true, recoveredMarker });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
    await page.screenshot({ path: input.screenshotPath });
    console.log(`Preview screenshot: ${input.screenshotPath}`);
    const viewedIdleStarted = Date.now();
    await idle;
    const idleElapsedMs = Date.now() - idleStarted;
    assert(idleElapsedMs >= 65_000);
    assert.equal(await call("eval", { script: "window.fixtureIdentity" }), identity);
    assert.match(await call("snapshot", {}), /Preserved after idle/);
    await call("click", { selector: "#greeting button" });
    assert.match(await call("get_text", { selector: "#result" }), /Hello, Preserved after idle/);
    checks.push({ scenario: "65-second native unsaved form", pass: true, idleElapsedMs, identity });
    await delay(Math.max(0, 65_000 - (Date.now() - viewedIdleStarted)));
    const retained = await viewed("({ identity: window.fixtureIdentity, value: document.querySelector('#name').value, result: document.querySelector('#result').textContent })");
    assert.deepEqual(retained, { identity: viewedIdentity, value: "Viewed unsaved form", result: "Ready" });
    await viewed(["click", "#greeting button"]);
    assert.equal(await viewed("document.querySelector('#result').textContent"), "Hello, Viewed unsaved form");
    checks.push({ scenario: "viewed document survives reconnect and 65 seconds with unsaved form", pass: true, elapsedMs: Date.now() - viewedIdleStarted, retained });
    const finalMarker = await marker();
    await page.waitForFunction((rgb: number[]) => (window as PreviewFixtureWindow).markerGate(0, rgb), finalMarker.rgb);
    assert.equal(navigations.length, 2, "Only the initial load and intentional fresh-observer reload may navigate");
    await inventoryRecoveryBrowsers(input.binaryPath, input.dataDir, "after-idle");
    evidence.pass = true;
    console.log("PASS: the same live document and unsaved form survive 65 seconds idle; the next agent tool call completes.");
  } catch (error) {
    evidence.pass = false;
    evidence.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    try {
      if (page) {
        evidence.frameProofs = await page.evaluate(() => (window as PreviewFixtureWindow).frameProofs).catch(() => []);
        evidence.streams = await page.evaluate(() => (window as PreviewFixtureWindow).fixtureSources?.map(({ source, ...record }) => ({ ...record, readyState: source.readyState }))).catch(() => []);
        await page.screenshot({ path: input.screenshotPath }).catch(() => {});
      }
    } finally {
      await closePreview();
    }
  }
}

const ownedTrees = new Map<number, { session: string; tree: BrowserProcessTree }>();
const inventories: Array<Record<string, unknown>> = [];
const ownedTransports = new Map<number, string>();

async function inventoryRecoveryBrowsers(binaryPath: string, home: string, phase: string) {
  const directory = join(home, ".agent-browser");
  const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".pid")) : [];
  const sessions = [];
  for (const name of names) {
    const session = name.slice(0, -4);
    const pidFile = join(directory, name);
    const daemon = Number(readFileSync(pidFile, "utf8").trim());
    const tree = await browserProcessTree(binaryPath, daemon, session);
    assert(tree, `Cannot establish owned daemon identity for ${session}`);
    assert(tree.members.size > 1, `No native browser descendants recorded for ${session}`);
    ownedTrees.set(daemon, { session, tree });
    sessions.push({ session, pidFile, daemon, persistentProfile: browserProfileDirectory(session, home), persistentProfileExists: existsSync(browserProfileDirectory(session, home)), members: [...tree.members], groups: tree.groups, profiles: tree.profiles });
  }
  const listing = await promisify(execFile)("/bin/ps", ["-A", "-ww", "-o", "pid=,ppid=,lstart=,args="], { env: { PATH: process.env.PATH, LC_ALL: "C" } });
  const transports = listing.stdout.split("\n").flatMap((line) => {
    const [pid, ppid, ...rest] = line.trim().split(/\s+/);
    const args = rest.slice(5).join(" ");
    if (Number(ppid) !== process.pid || !args.startsWith(`${binaryPath} mcp`)) return [];
    const started = rest.slice(0, 5).join(" ");
    ownedTransports.set(Number(pid), started);
    return [{ pid: Number(pid), ppid: Number(ppid), started, command: args }];
  });
  inventories.push({ phase, transports, at: Date.now(), home, sessions,
    socketFiles: existsSync(directory) ? readdirSync(directory).filter((name) => /\.(pid|stream|sock)$/.test(name)).map((name) => join(directory, name)) : [] });
  if (phase !== "cleanup") assert.equal(sessions.length, 2, "Both the direct and viewed native sessions must be inventoried");
}

export async function closeRecoveryBrowsers(binaryPath: string, home: string, evidencePath: string) {
  const closes: Array<Record<string, unknown>> = [];
  const result: Record<string, unknown> = { home, inventories, closes };
  try {
    await inventoryRecoveryBrowsers(binaryPath, home, "cleanup");
    const sessions = [...new Set([...ownedTrees.values()].map(({ session }) => session))];
    for (const session of sessions) {
      try {
        const args = ["close", "--json", "--no-webmcp"];
        const output = await promisify(execFile)(binaryPath, args, {
          env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, AGENT_BROWSER_SESSION: session }, timeout: 15_000,
        });
        closes.push({ session, args, exitCode: 0, ...output });
        assert.equal(JSON.parse(output.stdout).success, true);
      } catch (error) {
        closes.push({ session, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
    const deadline = Date.now() + 10_000;
    let remaining: string[];
    do {
      remaining = [];
      for (const { session, tree } of ownedTrees.values()) if (await browserProcessesRunning(tree)) remaining.push(session);
      if (!remaining.length) break;
      await delay(100);
    } while (Date.now() < deadline);
    const directory = join(home, ".agent-browser");
    const sockets = existsSync(directory) ? readdirSync(directory).filter((name) => /\.(pid|stream|sock)$/.test(name)) : [];
    const remainingTransports = [];
    for (const [pid, started] of ownedTransports) {
      if (await browserProcessesRunning({ daemon: pid, members: new Map([[pid, started]]), groups: [] })) remainingTransports.push(pid);
    }
    result.remainingTransports = remainingTransports;
    assert.deepEqual(remainingTransports, []);
    result.remainingSessions = remaining;
    result.remainingSockets = sockets;
    result.checkedBeforeDataRemoval = existsSync(home);
    assert.deepEqual(remaining, []);
    assert.deepEqual(sockets, []);
    result.pass = true;
  } catch (error) {
    result.pass = false;
    result.error = error instanceof Error ? error.stack : String(error);
    throw error;
  } finally {
    writeFileSync(evidencePath, JSON.stringify(result, null, 2) + "\n");
  }
}
