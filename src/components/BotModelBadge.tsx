import type { Bot, InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ModelProviderMark } from "./ProviderIcons";
import { isHermesHarness } from "../../shared/hermes-harness";
import { modelOptionForId } from "@/lib/model-choices";

export function botModel(bot: Pick<Bot, "modelSelection">, instances: InstanceInfo[]): { instance: InstanceInfo; label: string } | null {
  const instance = instances.find((item) => item.instanceId === bot.modelSelection.instanceId);
  if (!instance) return null;
  const id = bot.modelSelection.model || instance.models?.default || "";
  const label = modelOptionForId(instance, id)?.label ?? (id === "hermes-default" ? t("model.simple.unavailable") : id);
  return { instance, label: label || (isHermesHarness(instance) ? t("model.simple.unavailable") : instance.displayName) };
}

export function botTooltip(bot: Pick<Bot, "name" | "title" | "chiefOfStaff" | "modelSelection">, instances: InstanceInfo[]): string {
  const model = botModel(bot, instances);
  return [
    bot.name,
    bot.title.trim(),
    bot.chiefOfStaff ? t("sidebar.bot.chiefOfStaff") : "",
    model ? t("sidebar.bot.modelBadge", { model: model.label, engine: isHermesHarness(model.instance)
      ? modelOptionForId(model.instance, bot.modelSelection.model || model.instance.models.default)?.provider ?? t("model.choose") : model.instance.displayName }) : "",
  ].filter(Boolean).join(" · ");
}

export function BotModelBadge({ bot, instances, avatarSize }: {
  bot: Pick<Bot, "modelSelection">;
  instances: InstanceInfo[];
  avatarSize: number;
}) {
  const model = botModel(bot, instances);
  if (!model) return null;
  const size = Math.max(14, Math.round(avatarSize * 0.4));
  const provider = modelOptionForId(model.instance, bot.modelSelection.model || model.instance.models.default)?.provider;
  const description = t("sidebar.bot.modelBadge", { model: model.label, engine: isHermesHarness(model.instance) ? provider ?? t("model.choose") : model.instance.displayName });
  return (
    <span data-testid="model-badge" role="img" aria-label={description} title={model.label}
      className="absolute -bottom-0.5 -left-0.5 flex items-center justify-center rounded-full border-2 border-panel bg-panel"
      style={{ width: size, height: size }}>
      <ModelProviderMark instance={model.instance} provider={provider} size={size - 4} subtle />
    </span>
  );
}

/** Simple mode's faded engine mark. It has no title of its own, so hovering it still shows the row's tooltip with the model and engine. */
export function BotEngineMark({ bot, instances, className }: { bot: Pick<Bot, "modelSelection">; instances: InstanceInfo[]; className?: string }) {
  const model = botModel(bot, instances);
  if (!model) return null;
  const provider = modelOptionForId(model.instance, bot.modelSelection.model || model.instance.models.default)?.provider;
  return (
    <span data-testid="model-badge" role="img" aria-label={t("sidebar.bot.modelBadge", { model: model.label, engine: isHermesHarness(model.instance) ? provider ?? t("model.choose") : model.instance.displayName })}
      className={cn("flex shrink-0", className)}>
      <ModelProviderMark instance={model.instance} provider={provider} size={14} subtle />
    </span>
  );
}
