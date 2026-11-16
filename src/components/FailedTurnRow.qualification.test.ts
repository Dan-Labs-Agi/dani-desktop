import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceInfo } from "@/state/store";
import { failedTurnTool } from "../../shared/failed-turn";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {}, instances: [] as InstanceInfo[], bots: [] }, dispatch: fixture.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedTurnRow } = await import("./ChatView");

const engine: InstanceInfo = {
  instanceId: "root", driverKind: "hermesAgent", displayName: "Hermes", access: "custom",
  snapshot: { state: "available", authenticated: true }, models: { default: "codex:test", options: [] },
};
beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("a model refused before its first task", () => {
  it.each([
    "No API key configured. Run `hermes setup` to configure a provider.",
    "This model did not execute and consume the native qualification tool result. The task remains unstarted; no alternate model was used.",
  ])("renders an actionable ordinary headline and retains the diagnostic only in Details", cause => {
    const html = renderToStaticMarkup(createElement(FailedTurnRow, {
      tool: failedTurnTool(cause, { setup: true }), engine, onRetry: vi.fn(),
    }));
    const ordinary = html.replace(/<details[\s\S]*?<\/details>/g, "");
    expect(ordinary).toContain("Settings → Model providers");
    expect(ordinary).toContain("try again");
    expect(ordinary).not.toMatch(/hermes|native qualification/i);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    if (cause.includes("qualification")) {
      expect(ordinary).toContain("Your task has not started");
      expect(ordinary).toContain("no other model was used");
    }
  });
});
