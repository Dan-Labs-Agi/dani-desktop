import type { AppState, InstanceInfo, ModelSelection } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";
import type { ModelVariantOption } from "../../shared/runtime-events";
import { isDaniFreeInstance } from "../../shared/dani-free";
import { isHermesHarness } from "../../shared/hermes-harness";
import { modelName } from "./simple-model-menu";
import { modelOptionForId, daniModelLabel } from "./model-choices";
import { t } from "./i18n";

export function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance && (isDaniFreeInstance(instance) || isHermesHarness(instance)) ? modelName(instance, model) : instance?.models.options.find((option) => option.id === model)?.label ?? model;
}

export function modelProvider(instance: InstanceInfo | undefined, model: string): string | undefined {
  if (instance && isDaniFreeInstance(instance)) return undefined;
  return modelOptionForId(instance, model)?.provider;
}

export function effortLabel(level: EffortLevel): string {
  return t(`model.effort.${level}` as Parameters<typeof t>[0]);
}

export const variantLabel = (option: ModelVariantOption, instance?: InstanceInfo): string => {
  if (instance && isDaniFreeInstance(instance)) return option.id === "default" ? t("model.effort.default") : daniModelLabel(option);
  return option.id === "default" && instance?.driverKind === "opencodeGo" ? t("model.variant.openCodeDefault") : option.label;
};

/** ACP variant ids are opaque; their model/session declares the available choices. */
export function variantChoices(state: Pick<AppState, "instances" | "modelVariantSessions">, selection: ModelSelection, threadId: string | undefined) {
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!instance?.capabilities?.modelVariants) return null;
  const session = threadId === undefined ? undefined : state.modelVariantSessions[threadId];
  const reported = session?.instanceId === selection.instanceId && session.model === selection.model ? session.variants : undefined;
  const options = reported?.options ?? instance.models.options.find((option) => option.id === selection.model)?.variants ?? [];
  if (!options.length && selection.variant === undefined) return null;
  return { instance, reported, options };
}

