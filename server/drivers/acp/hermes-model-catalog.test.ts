import { describe, expect, it } from "vitest";
import { buildHermesModelCatalog, requireHermesModelSelection } from "./hermes-model-catalog.ts";
import type { ModelCatalog } from "../../contracts.ts";

const native = {
  providers: [
    { id: "openai-codex", label: "OpenAI Codex", models: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"], authenticatedModels: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"], toolModels: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] },
    { id: "opencode-zen", label: "OpenCode Zen", models: ["shared-model"], authenticatedModels: [] },
    { id: "kilocode", label: "Kilo Code", models: ["shared-model"], authenticatedModels: [] },
    { id: "anthropic", label: "Anthropic", models: ["claude-sonnet-5"], authenticatedModels: [] },
    { id: "xai", label: "xAI", models: ["grok-4.6"], authenticatedModels: [] },
  ],
};
const configured = { model: "gpt-5.6-sol", provider: "openai-codex" };
const empty: ModelCatalog = { default: "", options: [] };

describe("root provider model catalog", () => {
  it("keeps account-visible native routes, provider identity and one selected default without constructing an agent", () => {
    const catalog = buildHermesModelCatalog(native, configured, empty, {}, []);
    expect(catalog.default).toBe("openai-codex:gpt-5.6-sol");
    expect(catalog.options.find(row => row.id === catalog.default)).toMatchObject({ label: "gpt-5.6-sol", provider: "Codex", availability: "available" });
    expect(catalog.options.filter(row => row.id === "openai-codex:gpt-5.6-sol")).toHaveLength(1);
    expect(catalog.options.some(row => row.id === "hermes-default")).toBe(false);
    for (const model of ["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(catalog.options).toContainEqual(expect.objectContaining({ id: `openai-codex:${model}`, provider: "Codex", availability: "available" }));
    }
    expect(catalog.options.some(row => /hermes/i.test(row.label))).toBe(false);
    expect(catalog.options.filter(row => row.label === "shared-model").map(row => row.provider)).toEqual(["OpenCode", "Kilo Code"]);
  });

  it("groups the configured default with its native provider's other models", () => {
    const catalog = buildHermesModelCatalog({ providers: [{
      id: "custom:pi-local", label: "Pi Models", models: ["selected", "other"],
      authenticatedModels: ["selected", "other"], toolModels: ["selected", "other"],
    }] }, { provider: "custom:pi-local", model: "selected" }, empty, {}, []);
    expect(catalog.default).toBe("custom:pi-local:selected");
    expect(catalog.options.map(option => option.provider)).toEqual(["Pi Models", "Pi Models"]);
    expect(catalog.options.every(option => option.availability === "available")).toBe(true);
  });

  it("retains every repository provider route and free eligibility metadata without inventing access", () => {
    const catalog = buildHermesModelCatalog(native, configured, empty, {
      opencode: { id: "opencode", name: "OpenCode", env: [], models: { extra: { id: "extra", name: "Extra", tool_call: true, reasoning: false, attachment: false, modalities: { input: ["text"] } } } },
    }, [{ source: "opencode", catalog: { default: "opencode/free-model", options: [{ id: "opencode/free-model", label: "Free Model", tools: true, privacyNotice: "Public preview", mayTrainOnYourPrompts: true }] } }]);
    expect(catalog.options).toContainEqual(expect.objectContaining({ id: "opencode-zen:extra", provider: "OpenCode", availability: "unavailable" }));
    expect(catalog.options).toContainEqual(expect.objectContaining({ id: "dani-free:opencode:free-model", provider: "Dani Free", availability: "unavailable", privacyNotice: "Public preview", mayTrainOnYourPrompts: true }));
    expect(() => requireHermesModelSelection("opencode-zen:extra", catalog)).toThrow(/unavailable|auth|qualified/i);
    expect(() => requireHermesModelSelection("openai-codex:not-advertised", catalog)).toThrow(/catalog|available/i);
    expect(() => requireHermesModelSelection("openai-codex:gpt-5.6-terra", catalog)).not.toThrow();
  });

  it("never authorizes the known tool-discarding agent proxy, including the configured default", () => {
    const catalog = buildHermesModelCatalog(native, { model: "proxy-model", provider: "custom:opencode", toolDiscardingProxy: true }, empty, {}, []);
    expect(catalog.options.find(row => row.id === catalog.default)).toMatchObject({ provider: "OpenCode", tools: false, availability: "unavailable" });
    expect(() => requireHermesModelSelection(catalog.default, catalog)).toThrow(/tool/i);
  });

  it("does not let refreshed configured options override an explicit native model refusal", () => {
    const id = "custom:restricted:one";
    const catalog = buildHermesModelCatalog({ providers: [{
      id: "custom:restricted", label: "Restricted", models: ["one"], authenticatedModels: ["one"], toolModels: ["one"],
      unavailableModels: { one: "Tool calls are disabled for this model." },
    }] }, { provider: "custom:restricted", model: "one" }, empty, {}, [], [
      { id, label: "One", availability: "available", tools: true },
    ]);
    expect(catalog.options.find(option => option.id === id)).toMatchObject({
      availability: "unavailable", unavailableReason: "Tool calls are disabled for this model.",
    });
    expect(() => requireHermesModelSelection(id, catalog)).toThrow();
  });
  it("retains fresh local admission after its native provider is materialized", () => {
    const local: ModelCatalog = { default: "ollama::local-model", options: [
      { id: "ollama::local-model", label: "Local model", custom: true },
    ] };
    const catalog = buildHermesModelCatalog({ providers: [{
      id: "custom:ollama", label: "Ollama", models: ["local-model"], authenticatedModels: ["local-model"], toolModels: [],
    }] }, null, local, {}, []);
    const option = catalog.options.find(row => row.id === "custom:ollama:local-model");
    expect(option).toMatchObject({ label: "Local model", provider: "Ollama" });
    expect(option?.availability).not.toBe("unavailable");
    expect(() => requireHermesModelSelection("custom:ollama:local-model", catalog)).not.toThrow();
  });
});
