import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "dani-free-driver-")); dirs.push(d); return d; }
process.on("exit", () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const STUB = join(import.meta.dirname, "..", "test-fixtures", "dani-free-stub.mjs");

/** A placeholder file the driver finds as the bundled binary; the spawn seam runs the stub instead. */
function shim(dir: string): string {
  const path = join(dir, "dani-free-placeholder");
  writeFileSync(path, "placeholder\n");
  chmodSync(path, 0o755);
  return path;
}

async function loadDriver(dataDir: string, executable: string) {
  process.env.OMB_DATA_DIR = dataDir;
  process.env.DANI_FREE_EXECUTABLE = executable;
  // config.ts fixes DATA_DIR at import; the driver module reads it through config.ts.
  const { DaniFreeDriver, daniFreeDriverSeams } = await import("./dani-free-driver.ts");
  // Run the stub as `node stub.mjs start` through the real driver; works on every OS (no sh shim).
  daniFreeDriverSeams.spawnProcess = ((_file: string, args: readonly string[] = [], options: SpawnOptions = {}) =>
    spawn(process.execPath, [STUB, ...args], options)) as unknown as typeof spawn;
  return DaniFreeDriver;
}

describe("DaniFreeDriver", () => {
  it("starts the bundled proxy and serves exactly the Dani Free Auto model", async () => {
    const dir = tmp();
    const driver = await loadDriver(dir, shim(dir));
    const instance = await driver.create({
      instanceId: "daniFree", displayName: "Dani Free", environment: {}, enabled: true, config: {},
    });
    expect(instance.driverKind).toBe("daniFree");
    expect(instance.models.default).toBe("dani-free-auto");
    expect(instance.models.options).toEqual([{ id: "dani-free-auto", label: "Dani Free Auto" }]);
    const snapshot = await instance.snapshot();
    expect(snapshot.state).toBe("available");
    await instance.dispose();
  }, 30_000);

  it("resolves an honest unavailable instance when no proxy is bundled", async () => {
    const dir = tmp();
    const driver = await loadDriver(dir, join(dir, "missing-binary"));
    const instance = await driver.create({
      instanceId: "daniFree", displayName: "Dani Free", environment: {}, enabled: true, config: {},
    });
    const snapshot = await instance.snapshot();
    expect(snapshot.state).toBe("unavailable");
    await instance.dispose();
  }, 15_000);

  it("resolves unavailable, never throws synchronously, when the config switches the proxy off", async () => {
    const dir = tmp();
    const driver = await loadDriver(dir, shim(dir));
    const instance = await driver.create({
      instanceId: "daniFree", displayName: "Dani Free", environment: {}, enabled: true, config: { disabled: true },
    });
    expect((await instance.snapshot()).state).toBe("unavailable");
    await instance.dispose();
    expect(driver.decodeConfig({ disabled: true })).toEqual({ disabled: true });
    expect(() => driver.decodeConfig({ disabled: "yes" })).toThrow();
  }, 15_000);
});
