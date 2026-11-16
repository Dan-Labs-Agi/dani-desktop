import { describe, expect, it } from "vitest";
import { hermesModelSelection } from "./hermes-harness.ts";

const configs = { claude: { driver: "claudeAgent" }, hermes: { driver: "hermesAgent" } };

describe("Hermes harness selection", () => {
  it.each(["openai:gpt-fixture", "openrouter:qwen/fixture", "ollama::local-model", "legacy-unscoped-model"])(
    "keeps the selected model %s without guessing a provider", (model) => {
      expect(hermesModelSelection({ instanceId: "claude", model, effort: "high" }, configs))
        .toEqual({ instanceId: "hermes", model });
    },
  );

  it("preserves a saved Hermes account and its model-specific controls", () => {
    const saved = { instanceId: "other-hermes", model: "openai:gpt-fixture", variant: "high" };
    expect(hermesModelSelection(saved, { ...configs, "other-hermes": { driver: "hermesAgent", enabled: false } }))
      .toEqual(saved);
  });

  it("does not move bots back to another harness when Hermes is disabled or absent", () => {
    const saved = { instanceId: "claude", model: "openai:gpt-fixture" };
    expect(hermesModelSelection(saved, { claude: configs.claude })).toEqual({ ...saved, instanceId: "hermes" });
    expect(hermesModelSelection(saved, { ...configs, hermes: { ...configs.hermes, enabled: false } }))
      .toEqual({ ...saved, instanceId: "hermes" });
  });

  it("retains an unconfigured bot instead of silently assigning it a paid model", () => {
    expect(hermesModelSelection(undefined, configs)).toEqual({ instanceId: "", model: "" });
  });
});
