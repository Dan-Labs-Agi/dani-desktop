import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const instance = (instanceId: string, displayName: string) => ({ instanceId, displayName, snapshot: { state: "available" }, models: { default: "m", options: [{ id: "m", label: "M" }] } });
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { instances: [instance("dani", "Dani"), instance("dani-client", "Dani"), instance("claude", "Claude"), instance("codex", "Codex")] } }),
}));

import type { Bot } from "@/state/store";
import { FallbackChain } from "./ModelSection";

const options = (bot: Partial<Bot>) => [...renderToStaticMarkup(createElement(FallbackChain, {
  bot: { modelSelection: { instanceId: "claude", model: "m" }, ...bot } as Bot,
  onChange: () => {},
})).matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]).filter((value) => value !== "m");

describe("backup providers", () => {
  it("lists Dani once though it has two routes, and not again once Dani is the main or a backup", () => {
    expect(options({})).toEqual(["dani", "codex"]);
    expect(options({ fallback: [{ instanceId: "dani-client", model: "m" }] } as Partial<Bot>)).toEqual(["codex"]);
    expect(options({ modelSelection: { instanceId: "dani", model: "m" } } as Partial<Bot>)).toEqual(["claude", "codex"]);
  });
});
