// A real server booted with only HOME set (no data-dir env) keeps its data in ~/.danibot, and an upstream
// OpenMausBot profile sitting in ~/.openmausbot in the same home is neither read nor written.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const WEBHOOK_PORT = 39000 + Math.floor(Math.random() * 10_000);
const UPSTREAM_CONFIG = JSON.stringify({ instances: { upstream: { driver: "upstream-profile-shadow" } } });

let home: string;
let child: ChildProcess;
let stderr = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "dani-default-dir-"));
  const upstream = join(home, ".openmausbot");
  mkdirSync(upstream, { recursive: true });
  writeFileSync(join(upstream, "config.json"), UPSTREAM_CONFIG);
  const env: NodeJS.ProcessEnv = {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    OMB_PORT: String(PORT),
    OMB_WEBHOOK_PORT: String(WEBHOOK_PORT),
    OMB_BROWSER_CONNECTION: join(home, "browser-test-connection.json"),
  };
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start:\n${stderr}`);
}, 30_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(home);
});

describe("default data dir of a real server", () => {
  it("is ~/.danibot", () => {
    expect(existsSync(join(home, ".danibot"))).toBe(true);
    expect(existsSync(join(home, ".danibot", "environment-id"))).toBe(true);
  });
  it("leaves an upstream ~/.openmausbot profile exactly as it was", () => {
    expect(readdirSync(join(home, ".openmausbot"))).toEqual(["config.json"]);
    expect(readFileSync(join(home, ".openmausbot", "config.json"), "utf8")).toBe(UPSTREAM_CONFIG);
  });
  it("did not adopt the upstream profile's settings", () => {
    const own = join(home, ".danibot", "config.json");
    expect(!existsSync(own) || !readFileSync(own, "utf8").includes("upstream-profile-shadow")).toBe(true);
  });
});
