// Screenshots of the REAL packaged app: launches the unpacked desktop build with an empty disposable home,
// attaches over the Chrome DevTools protocol, and captures full pages of what the renderer actually shows.
// Run under xvfb (a packaged app that never leaves its startup screen fails this step). Nothing is mocked: no fixture server, no isolated renderer.
//
//   xvfb-run -a node scripts/capture-product-pages.mjs --exe release/linux-unpacked/danibot --out shots
//
// Each step records what was on screen (visible buttons and headings) beside its PNG, so a reviewer can see
// which pages were reached and which were not. A step that cannot be reached is reported, not skipped silently.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const required = [];
for (let i = 0; i < args.length - 1; i += 1) if (args[i] === "--require") required.push(args[i + 1]);
const exe = path.resolve(opt("--exe", "release/linux-unpacked/danibot"));
const out = path.resolve(opt("--out", "shots"));
const port = Number(opt("--port", 9333));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });

const sandbox = mkdtempSync(path.join(tmpdir(), "dani-shots-"));
const home = path.join(sandbox, "home");
mkdirSync(home, { recursive: true });

// --seed-unreadable-credentials: plant a credentials file the OS store cannot
// read back, so the launch takes the real unavailable-store path and the
// product shows its actual locked-sign-ins notice. The bytes are garbage on
// purpose; nothing about a real store or a real person's data is touched.
const seedUnreadable = process.argv.includes("--seed-unreadable-credentials");
// The packaged app's package.json has name "dani-desktop" and no productName,
// so Electron's Linux userData is $XDG_CONFIG_HOME/dani-desktop (verified from
// the shipped deb's app.asar). "Dani Bot" here would be the installer/mac name,
// which the Linux runtime never reads.
const seedDir = path.join(sandbox, "config", "dani-desktop");
if (seedUnreadable) {
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(path.join(seedDir, "credentials.bin"), Buffer.from("not-a-real-credential-store"));
}
const child = spawn(exe, [`--remote-debugging-port=${port}`, "--password-store=basic", "--no-sandbox"], {
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(sandbox, "config"), XDG_SESSION_TYPE: "x11" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", (c) => (log += c));

async function pageTarget() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools:"));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error(`no page target appeared\n${log.slice(-2000)}`);
}

// The window first shows the startup screen (a data: page); the product is the page the server serves over http(s).
async function appTarget() {
  const deadline = Date.now() + 120_000;
  let seen = "";
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pages = list.filter((t) => t.type === "page" && !t.url.startsWith("devtools:"));
      seen = pages.map((t) => t.url.slice(0, 60)).join(" | ");
      const app = pages.find((t) => /^https?:\/\//.test(t.url));
      if (app) return app;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`the app never left its startup screen; pages seen: ${seen}\n${log.slice(-2000)}`);
}
await pageTarget();
const target = await appTarget();
// A seeded store the app never reads fails every --require later with no hint why.
// Assert the boot probe actually classified it before spending the run on screenshots.
if (seedUnreadable) {
  const origin = new URL(target.url).origin;
  const state = await (await fetch(`${origin}/api/connectors/connected`)).json();
  if (state.credentialStore !== "unavailable") {
    throw new Error(
      `seeded unreadable credentials at ${path.join(seedDir, "credentials.bin")} but the app reported ` +
      `credentialStore=${JSON.stringify(state.credentialStore)}; the seed path does not match the app's userData dir`,
    );
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

const diagnostics = { console: [], failedRequests: [] };
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
    diagnostics.console.push(`${message.params.type}: ${message.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
  } else if (message.method === "Runtime.exceptionThrown") {
    diagnostics.console.push(`exception: ${(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 300)}`);
  } else if (message.method === "Network.loadingFailed") {
    diagnostics.failedRequests.push(`${message.params.errorText} ${message.params.type}`);
  } else if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
    diagnostics.failedRequests.push(`${message.params.response.status} ${message.params.response.url.slice(0, 160)}`);
  }
});
await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const SNAPSHOT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80);
  return {
    title: document.title,
    url: location.href,
    headings: [...document.querySelectorAll("h1,h2,h3,[role=dialog]")].filter(visible).map(label).filter(Boolean).slice(0, 20),
    buttons: [...document.querySelectorAll("button,[role=button],[role=tab],a[href]")].filter(visible).map(label).filter(Boolean).slice(0, 120),
    webgl: (() => { try { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })(),
    robots: [...document.querySelectorAll("[data-robot-renderer]")].map((el) => el.getAttribute("data-robot-renderer") + (el.getAttribute("data-robot-error") ? ": " + el.getAttribute("data-robot-error") : "")).slice(0, 5),
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  };
})()`;

const record = [];
async function shoot(name, note = "") {
  await sleep(1200);
  const snap = await evaluate(SNAPSHOT);
  const metrics = await cdp("Page.getLayoutMetrics");
  const height = Math.max(900, Math.min(Math.ceil(metrics.cssContentSize.height), 8000));
  const shot = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height, scale: 1 },
  });
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
  record.push({ name, note, ...snap });
  console.log(`[capture] ${name}.png ${1440}x${height}`);
}

// click the visible control whose label matches; false when there is none
const click = (pattern) => evaluate(`(() => {
  const re = new RegExp(${JSON.stringify(pattern)}, "i");
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ");
  // Actually on screen: sized and inside the viewport, so an off-canvas control cannot pass the journey.
  const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth; };
  const el = [...document.querySelectorAll("button,[role=button],[role=tab],a[href],[role=menuitem]")]
    .find((e) => onScreen(e) && re.test(label(e)));
  if (!el) return false;
  el.click();
  return label(el);
})()`);

try {
  await sleep(3000);
  await shoot("01-first-screen", `first screen of an empty profile at ${target.url.slice(0, 60)}`);
  const steps = (opt("--steps", "") || "").split("|").filter(Boolean);
  let n = 2;
  for (const raw of steps) {
    const repeat = raw.startsWith("+");
    const pattern = repeat ? raw.slice(1) : raw;
    for (let round = 0; round < (repeat ? 8 : 1); round += 1) {
      if (pattern === "ESC") {
        for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await shoot(`${String(n).padStart(2, "0")}-escape`, "pressed Escape");
        n += 1;
        break;
      }
      // a menu or dialog can still be opening: look again for a few seconds before calling the control absent
      let hit = await click(pattern);
      for (let attempt = 0; !hit && attempt < 8 && !repeat; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        hit = await click(pattern);
      }
      if (!hit) {
        if (!repeat || round === 0) {
          record.push({ name: `step-${n}`, note: `NOT REACHED: no visible control matching /${pattern}/` });
          console.log(`[capture] not reached: ${pattern}`);
          if (!repeat) process.exitCode = 1;
        }
        break;
      }
      await shoot(`${String(n).padStart(2, "0")}-${pattern.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, `clicked "${hit}"`);
      n += 1;
    }
  }
  for (const pattern of required) {
    let found = false;
    for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
      found = await evaluate(`Boolean(document.body && new RegExp(${JSON.stringify(pattern)}, "i").test(document.body.innerText))`);
      if (!found) await sleep(500);
    }
    record.push({ name: "require", note: found ? `REQUIRED PRESENT: /${pattern}/` : `REQUIRED MISSING: /${pattern}/` });
    console.log(`[capture] require /${pattern}/: ${found ? "present" : "MISSING"}`);
    if (!found) {
      await shoot(`required-missing-${required.indexOf(pattern) + 1}`, `required state missing: /${pattern}/`);
      process.exitCode = 1;
    }
  }
} finally {
  writeFileSync(path.join(out, "tour.json"), JSON.stringify(record, null, 2));
  writeFileSync(path.join(out, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  writeFileSync(path.join(out, "app.log"), log.slice(-20000));
  ws.close();
  child.kill("SIGTERM");
}
