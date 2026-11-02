// TEMPORARY diagnostic for the Windows Electron startup crash class (class 3
// of the windows-latest CI failures): launches bare Electron (no app code)
// with default flags and with --no-sandbox. Bare crashing like the security
// fixtures points at the runner environment; bare passing points at fixture/
// product code. Remove when the class is resolved.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const electron = require("electron");
const fixture = fileURLToPath(new URL("./fixtures/bare-launch.cjs", import.meta.url));
const xvfb = process.platform === "linux" && !process.env.DISPLAY
  ? spawnSync("which", ["xvfb-run"], { encoding: "utf8" }).stdout.trim()
  : "";
const canRun = process.platform !== "linux" || Boolean(process.env.DISPLAY) || Boolean(xvfb);

function launchBare(extraArgs) {
  const command = xvfb || electron;
  const args = xvfb ? ["-a", electron, ...extraArgs, fixture] : [...extraArgs, fixture];
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill(), 45_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

for (const variant of [["default flags", []], ["--no-sandbox", ["--no-sandbox"]]]) {
  const [label, extraArgs] = variant;
  it.runIf(canRun)(`win-diag: bare Electron launches with ${label}`, async () => {
    const result = await launchBare(extraArgs);
    expect(
      result.code,
      `signal=${result.signal} stdout=[${result.stdout.trim()}] stderr=[${result.stderr.trim().slice(0, 800)}]`,
    ).toBe(0);
    expect(result.stdout).toContain("bare-ready");
  });
}
