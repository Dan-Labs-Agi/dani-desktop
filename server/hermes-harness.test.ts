import { describe, expect, it, vi } from "vitest";
import { withHermesHarness } from "./hermes-harness.ts";
import { ProviderRegistry } from "./harness/registry.ts";
import { makeFakeDriver } from "./testing/fake-driver.ts";

describe("Hermes execution boundary", () => {
  it("blocks non-Hermes turns even after a provider reload or custom decoration", async () => {
    const fake = makeFakeDriver({ kind: "other-agent" });
    const run = vi.fn(async () => ({ turnId: "must-not-run" }));
    const registry = new ProviderRegistry([fake.driver], { executionGuard: withHermesHarness });
    try {
      for (let reload = 0; reload < 2; reload++) {
        await registry.load({ legacy: { driver: "other-agent" } }, (instance) => {
          instance.adapter.sendTurn = run;
          return instance;
        });
        await expect(registry.get("legacy")!.adapter.sendTurn({ threadId: "t", text: "send" }))
          .rejects.toMatchObject({ code: "hermes_harness_required", status: 409 });
      }
      expect(run).not.toHaveBeenCalled();
    } finally {
      await registry.disposeAll();
    }
  });
});
