// The browser-control grant, ported from upstream 0.1.130 (e08651f): a
// separate per-device capability, off by default, because a bot's browser is
// normally signed into the person's real accounts. These tests pin the
// fail-closed behaviour on both sides of the port: the registry default and
// persistence, the route classifier, and old records gaining nothing.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.DANI_COMPANION_DIR = mkdtempSync(join(tmpdir(), "dani-companion-test-"));

const { DeviceRegistry } = await import("./devices.ts");
const { isBrowserControlAccess, BROWSER_LIVE_ROUTE, BROWSER_ACTION_ROUTE } = await import("./routes.ts");
const { DATA_DIR } = await import("./state.ts");

afterEach(() => {
  // DATA_DIR is captured at module import: clear its contents, never the dir.
  rmSync(join(DATA_DIR, "devices.json"), { force: true });
});

function pairedDevice(reg: InstanceType<typeof DeviceRegistry>) {
  const window = reg.openPairing();
  const result = reg.redeem(window.code, "test phone");
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("browser control grant", () => {
  it("is off by default for a freshly paired device", () => {
    const reg = new DeviceRegistry();
    const { device } = pairedDevice(reg);
    expect(device.browserControlAccess).toBe(false);
    expect(device.cloudDesktopAccess).toBe(false);
  });

  it("does not appear in list() output as anything but the public flag", () => {
    const reg = new DeviceRegistry();
    pairedDevice(reg);
    const listed = reg.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].browserControlAccess).toBe(false);
    expect("tokenHash" in listed[0]).toBe(false);
  });

  it("toggles on and persists through a reload", () => {
    const reg = new DeviceRegistry();
    const { device } = pairedDevice(reg);
    expect(reg.setBrowserControlAccess(device.id, true)).toBe(true);
    const reloaded = new DeviceRegistry();
    const found = reloaded.list().find((d) => d.id === device.id);
    expect(found?.browserControlAccess).toBe(true);
    expect(reloaded.setBrowserControlAccess(device.id, false)).toBe(true);
    expect(new DeviceRegistry().list().find((d) => d.id === device.id)?.browserControlAccess).toBe(false);
  });

  it("returns false for an unknown device id", () => {
    const reg = new DeviceRegistry();
    expect(reg.setBrowserControlAccess("no-such-device", true)).toBe(false);
  });

  it("grants nothing to records written before the grant existed", () => {
    writeFileSync(join(DATA_DIR, "devices.json"), JSON.stringify({
      devices: [{ id: "old-1", tokenHash: "x".repeat(64), name: "old phone", createdAt: 1, lastSeenAt: 1, cloudDesktopAccess: true }],
    }));
    const reg = new DeviceRegistry();
    const old = reg.list().find((d) => d.id === "old-1");
    expect(old?.cloudDesktopAccess).toBe(true);
    expect(old?.browserControlAccess).toBe(false);
  });

  it("a cloud-desktop grant does not imply a browser grant", () => {
    const reg = new DeviceRegistry();
    const { device } = pairedDevice(reg);
    expect(reg.setCloudDesktopAccess(device.id, true)).toBe(true);
    expect(reg.list().find((d) => d.id === device.id)?.browserControlAccess).toBe(false);
  });
});

describe("browser control route classifier", () => {
  it("matches exactly the live and action routes", () => {
    expect(isBrowserControlAccess("GET", "/api/bots/bot-1/browser/live")).toBe(true);
    expect(isBrowserControlAccess("POST", "/api/bots/bot-1/browser/action")).toBe(true);
    expect(BROWSER_LIVE_ROUTE.method).toBe("GET");
    expect(BROWSER_ACTION_ROUTE.method).toBe("POST");
  });

  it("rejects swapped methods and lookalike paths", () => {
    expect(isBrowserControlAccess("POST", "/api/bots/bot-1/browser/live")).toBe(false);
    expect(isBrowserControlAccess("GET", "/api/bots/bot-1/browser/action")).toBe(false);
    expect(isBrowserControlAccess("GET", "/api/bots/bot-1/browser/live/extra")).toBe(false);
    expect(isBrowserControlAccess("GET", "/api/bots/bot-1/browser")).toBe(false);
    expect(isBrowserControlAccess("GET", "/api/bots/browser/live")).toBe(false);
    expect(isBrowserControlAccess("DELETE", "/api/bots/bot-1/browser/live")).toBe(false);
  });
});
