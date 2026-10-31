// Screenshots of the REAL packaged app: launches the unpacked desktop build with an empty disposable home,
// attaches over the Chrome DevTools protocol, and captures full pages of what the renderer actually shows.
// Run under xvfb. Nothing is mocked: no fixture server, no isolated renderer.
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
const exe = path.resolve(opt("--exe", "release/linux-unpacked/danibot"));
const out = path.resolve(opt("--out", "shots"));
const port = Number(opt("--port", 9333));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(out, { recursive: true });

const sandbox = mkdtempSync(path.join(tmpdir(), "dani-shots-"));
const home = path.join(sandbox, "home");
mkdirSync(home, { recursive: true });
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

const target = await pageTarget();
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
  const el = [...document.querySelectorAll("button,[role=button],[role=tab],a[href],[role=menuitem]")]
    .find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && re.test(label(e)); });
  if (!el) return false;
  el.click();
  return label(el);
})()`);

try {
  await sleep(4000);
  await shoot("01-first-screen", "first paint of an empty profile");
  const steps = (opt("--steps", "") || "").split("|").filter(Boolean);
  let n = 2;
  for (const pattern of steps) {
    const hit = await click(pattern);
    if (!hit) { record.push({ name: `step-${n}`, note: `NOT REACHED: no visible control matching /${pattern}/` }); console.log(`[capture] not reached: ${pattern}`); continue; }
    await shoot(`${String(n).padStart(2, "0")}-${pattern.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, `clicked "${hit}"`);
    n += 1;
  }
} finally {
  writeFileSync(path.join(out, "tour.json"), JSON.stringify(record, null, 2));
  writeFileSync(path.join(out, "app.log"), log.slice(-20000));
  ws.close();
  child.kill("SIGTERM");
}
