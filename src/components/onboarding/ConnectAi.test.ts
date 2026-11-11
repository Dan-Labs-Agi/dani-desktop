// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { ConnectAi } from "./ConnectAi";
import { NoEngines } from "../NoEngines";

const f = vi.hoisted(() => ({ instances: [] as InstanceInfo[], dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { instances: f.instances }, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/components/DesktopCapabilities", () => ({ WindowDragStrip: () => null }));
vi.mock("@/components/EngineSetup", () => ({
  EngineSetup: ({ instance }: { instance: InstanceInfo }) => createElement("div", { "data-engine-setup": instance.instanceId }),
}));
vi.mock("./beats/OrganisationRow", () => ({ OrganisationRow: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const engine = (id: string, available = false): InstanceInfo => ({
  instanceId: id, driverKind: id === "dani" ? "daniFree" : "opencodeGo", displayName: id === "dani-client" ? "OpenCode" : "Dani",
  snapshot: { state: available ? "available" : "unavailable", authenticated: available },
  models: { default: "service/model", options: [{ id: "service/model", label: "Helpful model", provider: "KiloCode" }] },
});
let host: HTMLDivElement, root: Root;
const show = async (noEngines = false) => { await act(async () => { root.render(noEngines ? createElement(NoEngines) : createElement(ConnectAi)); }); };
const press = async () => {
  const button = host.querySelector<HTMLButtonElement>("[data-dani-setup] button[data-primary]")!;
  await act(async () => { button.click(); });
};
beforeEach(() => {
  setLocale("en");
  f.instances = [engine("dani"), engine("dani-client"), { ...engine("claude"), driverKind: "claudeAgent", displayName: "Claude", install: { docsUrl: "https://example.test" } }];
  f.dispatch.mockReset();
  f.api.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith("/check")) return { ok: true };
    return { instances: f.instances.map((instance) => ({ ...instance, snapshot: { state: "available", authenticated: true } })) };
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Dani free setup", () => {
  it("never activates or probes policy-blocked routes and shows the organization reason", async () => {
    f.instances = [engine("dani", true), engine("dani-client", true)].map((instance) => ({
      ...instance, aiTest: "passed", policy: { organizationName: "Acme", reason: "Company models only." },
    }));
    await show();
    expect(host.textContent).not.toContain("Dani is ready");
    expect(host.textContent).toContain("Managed by Acme");
    expect(host.textContent).toContain("Company models only.");
    const action = host.querySelector<HTMLButtonElement>("[data-primary]");
    if (action && !action.disabled) await press();
    expect(f.api).not.toHaveBeenCalled();
  });

  it("prepares only the allowed free route, never optional paid agents", async () => {
    f.instances = [engine("dani"), {
      ...engine("dani-client"), policy: { organizationName: "Acme", reason: "This route is blocked." },
    }, { ...engine("claude", true), driverKind: "claudeAgent", install: { docsUrl: "https://example.test" } }];
    await show(); await press();
    expect(f.api.mock.calls.map(([path]) => path)).toEqual([
      "/api/instances/dani/install", "/api/instances/dani/refresh-models", "/api/instances/dani/check", "/api/instances",
    ]);
    expect(host.textContent).toContain("Dani is ready");
    expect(host.textContent).toContain("This route is blocked.");
  });

  it.each([true, false])("creates missing canonical routes on explicit setup for a legacy fleet (native route present: %s)", async (nativePresent) => {
    f.instances = nativePresent ? [engine("dani")] : [];
    const prepared = [engine("dani", true), engine("dani-client", true)];
    f.api.mockImplementation(async (path: string) => path.endsWith("/check") ? { ok: true } : { instances: prepared });
    await show();
    expect(f.api).not.toHaveBeenCalled();
    await press();
    expect(f.api.mock.calls.map(([path]) => path)).toEqual([
      "/api/instances/dani/install", "/api/instances/dani/refresh-models", "/api/instances/dani/check",
      "/api/instances/dani-client/install", "/api/instances/dani-client/refresh-models", "/api/instances/dani-client/check",
      "/api/instances",
    ]);
    expect(host.textContent).toContain("Dani is ready");
  });

  it.each(["/install", "/refresh-models", "/api/instances"])("revokes readiness when policy blocks a route at %s", async (blockedAt) => {
    f.instances = [engine("dani")];
    const available = [{ ...engine("dani", true), aiTest: "passed" as const }];
    const blocked = available.map((instance) => ({ ...instance, policy: { organizationName: "Acme", reason: "Company models only." } }));
    f.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/check")) return { ok: true };
      return { instances: path.endsWith(blockedAt) ? blocked : available };
    });
    await show(); await press();
    expect(host.textContent).not.toContain("Dani is ready");
    if (blockedAt !== "/api/instances") expect(f.api.mock.calls.some(([path]) => path.endsWith("/check"))).toBe(false);
    if (blockedAt === "/install") expect(f.api.mock.calls.some(([path]) => path.endsWith("/refresh-models"))).toBe(false);
  });

  it("does not treat organization-blocked model options as usable setup readiness", async () => {
    f.instances = [engine("dani", true)].map((instance) => ({
      ...instance, aiTest: "passed", models: { ...instance.models, options: instance.models.options.map((option) => ({ ...option, orgBlocked: true })) },
    }));
    await show(); await press();
    expect(host.textContent).not.toContain("Dani is ready");
    expect(f.api.mock.calls.some(([path]) => path.endsWith("/check"))).toBe(false);
  });
  it("rechecks the latest fleet policy before preparing the next free route", async () => {
    const available = [engine("dani", true), engine("dani-client", true)];
    f.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/check")) return { ok: true };
      return { instances: path.endsWith("/refresh-models") ? available.map((instance) => instance.instanceId === "dani-client"
        ? { ...instance, policy: { organizationName: "Acme", reason: "Additional route blocked." } } : instance) : available };
    });
    await show(); await press();
    expect(f.api.mock.calls.some(([path]) => path.includes("dani-client/"))).toBe(false);
    expect(host.textContent).toContain("Dani is ready");
  });


  it("prepares native Dani before starting the additional client and keeps the action bounded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.instances = [engine("dani", true), engine("dani-client", true)];
    f.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/install")) await gate;
      return path.endsWith("/check") ? { ok: true } : { instances: f.instances };
    });
    await show(); await press();
    expect(host.querySelector<HTMLButtonElement>("[data-primary]")?.disabled).toBe(true);
    expect(host.textContent).toContain("Setting up Dani");
    expect(f.api.mock.calls.filter(([path]) => path.endsWith("/install")).map(([path]) => path)).toEqual(["/api/instances/dani/install"]);
    await act(async () => { release(); });
    expect(host.textContent).toContain("Dani is ready");
    expect(f.api.mock.calls.map(([path]) => path)).toEqual([
      "/api/instances/dani/install", "/api/instances/dani/refresh-models", "/api/instances/dani/check",
      "/api/instances/dani-client/install", "/api/instances/dani-client/refresh-models", "/api/instances/dani-client/check",
      "/api/instances",
    ]);
  });

  it("never calls a missing free catalog ready, even if the service could answer", async () => {
    f.instances = [engine("dani", true), engine("dani-client", true)].map((instance) => ({ ...instance, models: { default: "", options: [] } }));
    f.api.mockImplementation(async (path: string) => path.endsWith("/check") ? { ok: true } : { instances: f.instances });
    await show(); await press();
    expect(host.textContent).not.toContain("Dani is ready");
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    expect(f.api.mock.calls.some(([path]) => path.endsWith("/check"))).toBe(false);
  });

  it("does not retain success when the fresh post-check snapshot says a route became unavailable", async () => {
    const prepared = [engine("dani", true), engine("dani-client", true)];
    f.api.mockImplementation(async (path: string) => {
      if (path.endsWith("/check")) return { ok: true };
      return { instances: path === "/api/instances" ? f.instances : prepared };
    });
    await show(); await press();
    expect(host.textContent).not.toContain("Dani is ready");
    expect(host.querySelector("[role=alert]")).not.toBeNull();
  });

  it("leads with Set up Dani and privacy disclosure, without installing missing agents", async () => {
    await show();
    expect(host.querySelector("[data-primary]")?.textContent).toBe("Set up Dani");
    expect(host.textContent).toMatch(/retain.*train/i);
    expect(host.querySelector("[data-engine-setup]")).toBeNull();
    expect(host.textContent).not.toMatch(/OpenCode|KiloCode|Claude|Terminal/);
    expect(f.api.mock.calls.some(([path]) => path.endsWith("/install") || path.endsWith("/check"))).toBe(false);
  });
  it("does not expose the duplicate built-in free client as another agent during Dani setup", async () => {
    f.instances = [engine("dani"), engine("dani-client"), {
      ...engine("opencodeGo", true), displayName: "OpenCode", install: { docsUrl: "https://example.test" },
      snapshot: { state: "available", authenticated: true, freeFallback: true },
    }];
    await show();
    expect(host.textContent).not.toMatch(/OpenCode|KiloCode/);
    expect(host.querySelector("[data-dani-setup]")).not.toBeNull();
  });
  it("replaces the NoEngines installation wall with the same setup", async () => {
    await show(true);
    expect(host.querySelector("[data-dani-setup]")).not.toBeNull();
    expect(host.querySelector("[data-primary]")?.textContent).toBe("Set up Dani");
    expect(host.querySelector("[data-engine-setup]")).toBeNull();
    expect(host.textContent).not.toMatch(/Claude|API key|Terminal/);
  });
  it("prepares and checks both routes after disclosure without rewriting chosen models", async () => {
    await show(); await press();
    for (const id of ["dani", "dani-client"]) {
      const calls = f.api.mock.calls.map(([path]) => path).filter((path) => path.startsWith(`/api/instances/${id}/`));
      expect(calls).toEqual([`/api/instances/${id}/install`, `/api/instances/${id}/refresh-models`, `/api/instances/${id}/check`]);
    }
    expect(host.textContent).toContain("Dani is ready");
    expect(f.dispatch.mock.calls.some(([action]) => action.type === "setModel")).toBe(false);
  });
  it("does not claim success from catalog or failed and untestable checks, and allows retry", async () => {
    f.instances = [engine("dani", true), engine("dani-client", true)];
    f.api.mockImplementation(async (path: string) => path.endsWith("/check") ? { ok: null } : { instances: f.instances });
    await show(); await press();
    expect(host.textContent).not.toContain("Dani is ready");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("couldn't");
    expect(host.querySelector("[data-primary]")?.textContent).toBe("Try again");
    f.api.mockImplementation(async (path: string) => path.endsWith("/check") ? { ok: true } : { instances: f.instances });
    await press();
    expect(host.textContent).toContain("Dani is ready");
  });
  it("keeps a verified free route available when additional preparation fails and hides raw errors", async () => {
    f.instances = [engine("dani", true), engine("dani-client")];
    f.api.mockImplementation(async (path: string) => {
      if (path.includes("dani-client/")) throw new Error("OpenCode KiloCode /internal/route failed");
      return path.endsWith("/check") ? { ok: true } : { instances: f.instances };
    });
    await show(); await press();
    expect(host.textContent).toContain("Dani is ready");
    expect(host.textContent).toContain("Additional free models");
    expect(host.textContent).not.toMatch(/OpenCode|KiloCode|internal/);
    expect(host.querySelector("[data-primary]")?.textContent).toBe("Try again");
  });
  it("shows installed signed-out agents as optional, not ready, and excludes missing agents", async () => {
    f.instances.push({ ...engine("codex", true), driverKind: "codex", displayName: "Codex", snapshot: { state: "available", authenticated: false }, install: { docsUrl: "https://example.test" } });
    await show();
    expect(host.textContent).toContain("Codex");
    expect(host.textContent).toContain("Sign-in required");
    expect(host.textContent).not.toContain("Claude");
    expect(host.textContent).not.toContain("Dani is ready");
  });
});
