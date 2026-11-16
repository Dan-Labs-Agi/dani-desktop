import { isHermesHarness } from "../shared/hermes-harness.ts";
import type { ProviderInstance } from "./contracts.ts";

export const HERMES_HARNESS_REQUIRED = "Bots run through Hermes. Choose a model configured in Hermes; other agent CLIs cannot run bot turns.";

export function withHermesHarness(instance: ProviderInstance): ProviderInstance {
  if (isHermesHarness(instance)) return instance;
  const unavailable = async (): Promise<never> => {
    throw Object.assign(new Error(HERMES_HARNESS_REQUIRED), { status: 409, code: "hermes_harness_required" });
  };
  instance.adapter.sendTurn = unavailable;
  if (instance.generateText) instance.generateText = unavailable;
  if (instance.generateMemoryText) instance.generateMemoryText = unavailable;
  return instance;
}
