import { spawn, type SpawnOptions } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledDaniFreeExecutable, buildDaniFreeSource, DANI_AUTO_MODEL, DANI_AUTO_MODEL_NAME,
  DaniFreeSupervisor, parseDaniFreeReadyLine,
} from "./dani-free.ts";

const STUB = join(import.meta.dirname, "test-fixtures", "dani-free-stub.mjs");

const stubSpawn = ((file: string, args: readonly string[] = [], options: SpawnOptions = {}) =>
  spawn(file, [STUB, ...args], options)) as unknown as typeof spawn;
const homes: string[] = [];
function home(): string { const h = mkdtempSync(join(tmpdir(), "dani-free-test-")); homes.push(h); return h; }
process.on("exit", () => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

describe("parseDaniFreeReadyLine", () => {
  it("parses a well-formed ready line", () => {
    const ready = parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://127.0.0.1:4242","port":4242,"pid":123,"apiKeyFile":"/tmp/k","privateMode":true}');
    expect(ready).toEqual({ baseUrl: "http://127.0.0.1:4242", port: 4242, pid: 123, apiKeyFile: "/tmp/k", privateMode: true });
  });
  it("keeps the origin when the proxy reports its OpenAI base with /v1, and rejects odd paths", () => {
    const withV1 = parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://127.0.0.1:4242/v1","port":4242,"pid":1,"apiKeyFile":"/k"}');
    expect(withV1?.baseUrl).toBe("http://127.0.0.1:4242");
    expect(parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://127.0.0.1:4242/api","port":4242,"pid":1,"apiKeyFile":"/k"}')).toBeNull();
    expect(parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://127.0.0.1:9999/v1","port":4242,"pid":1,"apiKeyFile":"/k"}')).toBeNull();
  });
  it("rejects noise, bad json, and non-loopback or missing fields", () => {
    expect(parseDaniFreeReadyLine("hello")).toBeNull();
    expect(parseDaniFreeReadyLine("DANI_FREE_READY {nope")).toBeNull();
    expect(parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://0.0.0.0:1","port":1,"pid":1,"apiKeyFile":"/k"}')).toBeNull();
    expect(parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://127.0.0.1:1","port":1,"pid":1}')).toBeNull();
    expect(parseDaniFreeReadyLine('DANI_FREE_READY {"baseUrl":"http://127.0.0.1:70000","port":70000,"pid":1,"apiKeyFile":"/k"}')).toBeNull();
  });
});

describe("bundledDaniFreeExecutable", () => {
  it("finds the platform binary under resources, or null when absent", () => {
    const resources = home();
    expect(bundledDaniFreeExecutable(resources, "linux", "x64")).toBeNull();
    const dir = join(resources, "dani-free", "linux", "x64");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "dani-free"), "bin");
    expect(bundledDaniFreeExecutable(resources, "linux", "x64")).toBe(join(dir, "dani-free"));
    expect(bundledDaniFreeExecutable(resources, "win32", "x64")).toBeNull();
  });
});

describe("buildDaniFreeSource", () => {
  const ready = { baseUrl: "http://127.0.0.1:9", port: 9, pid: 1, apiKeyFile: "/k", privateMode: false };
  it("shows exactly one model, the routing Auto model", () => {
    const source = buildDaniFreeSource(ready, "k", [DANI_AUTO_MODEL]);
    expect(source.baseUrl).toBe("http://127.0.0.1:9/v1");
    expect(source.model).toEqual({ id: DANI_AUTO_MODEL, name: DANI_AUTO_MODEL_NAME });
  });
  it("refuses any other model list", () => {
    expect(() => buildDaniFreeSource(ready, "k", ["gpt-4o"])).toThrow("single supported model");
    expect(() => buildDaniFreeSource(ready, "k", [DANI_AUTO_MODEL, "other"])).toThrow("single supported model");
  });
});

describe("DaniFreeSupervisor", () => {
  it("starts the stub proxy, reads its key, and exposes the Auto source", async () => {
    const h = home();
    const supervisor = new DaniFreeSupervisor({
      executable: process.execPath,
      home: h,
      privateMode: true,
      env: { STUB_MODE: "1" },
      // The real binary takes ["start"]; the stub runs as `node stub.mjs start`.
      spawnProcess: stubSpawn,
    });
    const source = await supervisor.start();
    expect(supervisor.isRunning()).toBe(true);
    expect(source).not.toBeNull();
    expect(source!.model.name).toBe("Dani Free Auto");
    expect(source!.apiKey).toBe("stub-key-0123456789");
    expect(source!.privateMode).toBe(true);
    expect(source!.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    await supervisor.stop();
    expect(supervisor.isRunning()).toBe(false);
  }, 20_000);

  it("resolves null, never throws, when the proxy dies before ready", async () => {
    const supervisor = new DaniFreeSupervisor({
      executable: process.execPath,
      home: home(),
      env: { STUB_DIE_EARLY: "1" },
      spawnProcess: stubSpawn,
    });
    expect(await supervisor.start()).toBeNull();
    expect(supervisor.isRunning()).toBe(false);
  }, 20_000);
});