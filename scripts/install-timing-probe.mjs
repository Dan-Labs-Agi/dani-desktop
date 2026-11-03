// Packaged-app startup timing probe (diagnostic, always exits 0).
// Launches a packaged desktop build, polls its loopback server, and records a
// JSON timeline: time to first /api/health answer, time to bootstrap ready
// (old product), terminal error codes, and the captured process log tail.
// Env: PROBE_EXE (required), PROBE_PORT=8799, PROBE_BUDGET_MIN=10,
//      PROBE_OUT (required), PROBE_LOG (required), PROBE_BOOTSTRAP=1 optional.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const exe = process.env.PROBE_EXE;
const out = process.env.PROBE_OUT;
const logPath = process.env.PROBE_LOG;
const port = Number(process.env.PROBE_PORT || 8799);
const budgetMs = Number(process.env.PROBE_BUDGET_MIN || 10) * 60_000;
const wantBootstrap = process.env.PROBE_BOOTSTRAP === "1";
// PROBE_EXPECT_NO_BOOTSTRAP=1: record what /api/runtime/bootstrap answers
// (expected: endpoint absent) without treating any answer as readiness.
const expectNoBootstrap = process.env.PROBE_EXPECT_NO_BOOTSTRAP === "1";
let bootstrapEndpoint = null;
if (!exe || !out || !logPath) { console.error("PROBE_EXE, PROBE_OUT and PROBE_LOG are required"); process.exit(2); }

const startedAt = Date.now();
const timeline = [];
const logs = [];
let firstHealthMs = null;
let readyMs = null;
let terminal = null;

const child = spawn(exe, [], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});
child.stdout.on("data", (chunk) => logs.push(String(chunk)));
child.stderr.on("data", (chunk) => logs.push(String(chunk)));
child.on("error", (error) => { terminal = { kind: "spawn-error", message: String(error) }; });

const get = async (path, timeoutMs = 4_000) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch (error) { return { ok: false, status: 0, error: String(error).slice(0, 200) }; }
};

let lastErrorCode = null;
let stableErrors = 0;
while (!terminal && Date.now() - startedAt < budgetMs) {
  const t = Date.now() - startedAt;
  const health = await get("/api/health");
  if (health.ok && firstHealthMs === null) firstHealthMs = t;
  const entry = { tMs: t, health: health.status || (health.ok ? 200 : 0) };
  if (wantBootstrap && health.ok) {
    const boot = await get("/api/runtime/bootstrap");
    if (boot.body) {
      entry.bootstrap = { state: boot.body.state ?? null, phase: boot.body.phase ?? null, errorCode: boot.body.error?.code ?? null };
      if (boot.body.state === "ready") { readyMs = t; terminal = { kind: "ready" }; }
      else if (boot.body.state === "blocked-error" || boot.body.state === "repairable-error") {
        const code = boot.body.error?.code ?? "unknown";
        if (code === lastErrorCode) stableErrors += 1; else { lastErrorCode = code; stableErrors = 1; }
        if (stableErrors >= 3) terminal = { kind: "error-stable", errorCode: code, state: boot.body.state };
      }
    }
  } else if (health.ok && !wantBootstrap) {
    if (expectNoBootstrap && bootstrapEndpoint === null) {
      const boot = await get("/api/runtime/bootstrap");
      bootstrapEndpoint = { httpStatus: boot.status, answersJson: boot.body !== null && boot.body !== undefined };
    }
    readyMs = t; terminal = { kind: "ready" };
  }
  timeline.push(entry);
  if (!terminal) await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!terminal) terminal = { kind: "budget-exhausted" };

try {
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-child.pid, "SIGKILL");
} catch { /* already gone */ }

const logText = logs.join("");
writeFileSync(logPath, logText);
writeFileSync(out, JSON.stringify({
  exe, port, startedAt: new Date(startedAt).toISOString(),
  timeToFirstHealthMs: firstHealthMs, timeToReadyMs: readyMs,
  budgetMs, terminal, bootstrapEndpoint, timeline, logTail: logText.slice(-4000),
}, null, 2));
console.log(`probe terminal=${terminal.kind} firstHealth=${firstHealthMs}ms ready=${readyMs}ms detail=${JSON.stringify(terminal)}`);
