import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "dani-free-driver-")); dirs.push(d); return d; }
process.on("exit", () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const STUB = join(import.meta.dirname, "..", "test-fixtures", "dani-free-stub.mjs");

/** An executable shim that runs the stub proxy as `node stub.mjs start`. */
function shim(dir: string): string {
  const path = join(dir, "dani-free-shim");
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${STUB}" "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

async function loadDriver(dataDir: string, executable: string) {
  process.env.OMB_DATA_DIR = dataDir;
  process.env.DANI_FREE_EXECUTABLE = executable;
  // config.ts fixes DATA_DIR at import; the driver module reads it through config.ts.
  const { DaniFreeDriver } = await import("./dani-free-driver.ts");
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
    expect(snapshot.models?.default).toBe("dani-free-auto");
    await instance.dispose();
  }, 30_000);

  it("rejects, never throws synchronously, when no proxy is bundled", async () => {
    const dir = tmp();
    const driver = await loadDriver(dir, join(dir, "missing-binary"));
    await expect(driver.create({
      instanceId: "daniFree", displayName: "Dani Free", environment: {}, enabled: true, config: {},
    })).rejects.toThrow("not bundled");
  }, 15_000);

  it("rejects when the instance config switches the proxy off", async () => {
    const dir = tmp();
    const driver = await loadDriver(dir, shim(dir));
    await expect(driver.create({
      instanceId: "daniFree", displayName: "Dani Free", environment: {}, enabled: true, config: { disabled: true },
    })).rejects.toThrow("switched off");
    expect(driver.decodeConfig({ disabled: true })).toEqual({ disabled: true });
    expect(() => driver.decodeConfig({ disabled: "yes" })).toThrow();
  }, 15_000);
});
