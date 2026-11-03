// Packaged-app startup timing probe (diagnostic; exits 1 when PROBE_REQUIRE_READY=1 and readiness never came).
// Launches a packaged desktop build, polls its loopback server, and records a
// JSON timeline: time to first /api/health answer, time to bootstrap ready
// (old product), terminal error codes, and the captured process log tail.
// Env: PROBE_EXE (required), PROBE_PORT=8799, PROBE_BUDGET_MIN=10,
//      PROBE_OUT (required), PROBE_LOG (required), PROBE_BOOTSTRAP=1 optional.
//      PROBE_REQUIRE_READY=1: exit 1 unless the terminal state is ready.
import { spawn, spawnSync } from "node:child_process";
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

// Who holds the port before launch? Names and pids only - never argv or env,
// which can carry tokens. Empty on a clean runner.
if (process.platform !== "win32") {
  const pre = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (pre.stdout?.trim()) logs.push(`[probe] listeners on :${port} before launch\n${pre.stdout}`);
}

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

// A stalled build needs evidence, not another blind rerun: record the process
// group the probe is about to kill (ancestry, state, command names only), who
// listens on the port now, and on macOS a short stack sample of the main
// process. No argv, no env: both can carry credentials.
if (terminal.kind === "budget-exhausted" && process.platform !== "win32") {
  try {
    const ps = spawnSync("ps", ["-Ao", "pid,ppid,pgid,stat,etime,comm"], { encoding: "utf8" });
    if (ps.stdout) logs.push(`[probe] process table at budget exhaustion\n${ps.stdout}`);
    const post = spawnSync("lsof", ["-nP", `-iTCP:${port}`], { encoding: "utf8" });
    if (post.stdout?.trim()) logs.push(`[probe] connections on :${port} at budget exhaustion\n${post.stdout}`);
    if (process.platform === "darwin" && child.pid) {
      const sample = spawnSync("sample", [String(child.pid), "3", "-mayDie"], { encoding: "utf8", timeout: 20_000 });
      const text = `${sample.stdout ?? ""}${sample.stderr ?? ""}`.trim();
      if (text) logs.push(`[probe] stack sample of pid ${child.pid}\n${text.split("\n").slice(0, 200).join("\n")}`);
    }
  } catch { /* diagnostics are best-effort */ }
}

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
if (process.env.PROBE_REQUIRE_READY === "1" && terminal.kind !== "ready") process.exitCode = 1;
