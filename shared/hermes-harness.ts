import type { ModelSelection } from "./wire.ts";

export const HERMES_HARNESS_DRIVER = "hermesAgent";
export const HERMES_INSTANCE_ID = "hermes";
export const NATIVE_MODEL_ID_MAX_LENGTH = 2048;

export function isHermesModelRoute(model: string): boolean {
  return model.length <= NATIVE_MODEL_ID_MAX_LENGTH && /^[a-z0-9_.-]+:[\w][\w./:+@-]*$/i.test(model);
}

export function isHermesHarness(instance: { driverKind: string }): boolean {
  return instance.driverKind === HERMES_HARNESS_DRIVER;
}

/** Changes only the harness. Provider/model IDs are never guessed or replaced by a different paid model. */
export function hermesModelSelection(
  selection: ModelSelection | undefined,
  configs: Readonly<Record<string, { driver: string; enabled?: boolean }>>,
): ModelSelection {
  if (!selection || (!selection.instanceId && !selection.model)) return { instanceId: "", model: "" };
  if (configs[selection.instanceId]?.driver === HERMES_HARNESS_DRIVER) return selection;
  const candidates = Object.entries(configs).filter(([, entry]) => entry.driver === HERMES_HARNESS_DRIVER);
  const target = candidates.find(([, entry]) => entry.enabled !== false) ?? candidates[0];
  return { instanceId: target?.[0] ?? HERMES_INSTANCE_ID, model: selection.model };
}
