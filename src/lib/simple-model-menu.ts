import type { InstanceInfo, ModelSelection } from "@/state/store";
import { needsCli, needsSignIn } from "@/components/EngineSetup";
import { t } from "./i18n";
import { filterCustomModels, partitionCustomModels, suggestedModels } from "./custom-models";
import { isCustomOnly, SIGN_IN_FAMILY_LABEL, signInFamily, splitEngineRail } from "./engine-rail";
import { displayModelLabel, shortModelLabel } from "./model-friendly";
import { choiceIsSelected, daniModelLabel, modelChoices, modelOptionForId, takesTypedModels, type ModelChoice } from "./model-choices";
import { DANI_FREE_INSTANCE_IDS, isDaniFreeInstance } from "../../shared/dani-free";
import { isHermesHarness } from "../../shared/hermes-harness";

export type ModelOption = InstanceInfo["models"]["options"][number];

export const SIMPLE_SEARCH_AFTER = 12;
export const CURRENT_GROUP_SUGGESTIONS = 4;
export const GROUP_SUGGESTIONS = 3;

export interface MenuModelRow {
  option: ModelChoice;
  instance?: InstanceInfo;
  unavailable?: boolean;
  model?: string;
  variant?: string;
  label: string;
  route?: string;
  current: boolean;
  blocked: boolean;
}

export type MenuGroupBody =
  | { kind: "policy"; organization: string; team?: boolean }
  | { kind: "setUp" }
  | { kind: "signIn" }
  | { kind: "empty"; loading: boolean }
  | {
    kind: "models";
    rows: MenuModelRow[];
    total: number;
    toggle: "more" | "less" | null;
    localFrom: number | null;
    signInForOwn: boolean;
    probing: boolean;
    unavailableRoutes?: InstanceInfo[];
  };

export interface MenuGroup {
  instance: InstanceInfo;
  label: string;
  provider: string;
  account?: string;
  body: MenuGroupBody;
}

export interface MenuCurrent {
  instance?: InstanceInfo;
  provider?: string;
  label: string;
  title: string;
  meta?: string;
  warning: boolean;
  pending: boolean;
  /** The organization turned the selected model off: nothing to set up, only another model to pick. */
  blocked?: boolean;
}

export interface SimpleMenu {
  current: MenuCurrent | null;
  follow: boolean;
  groups: MenuGroup[];
  search: boolean;
  query: string;
  results: number | null;
  empty: "loading" | "none" | null;
  busy: boolean;
}

export interface SimpleMenuInput {
  instances: readonly InstanceInfo[];
  listed: readonly InstanceInfo[];
  selection: ModelSelection;
  bot: { name: string; selection: ModelSelection; follows?: boolean };
  query: string;
  expanded: ReadonlySet<string>;
  probing: ReadonlySet<string>;
  loading: boolean;
  refreshing?: string | null;
}

export function providerName(instance: InstanceInfo): string {
  if (isHermesHarness(instance)) return t("model.choose");
  if (isDaniFreeInstance(instance)) return instance.driverKind === "opencodeGo" ? "OpenCode" : "Dani Free";
  const family = signInFamily(instance);
  if (family) return SIGN_IN_FAMILY_LABEL[family];
  if (instance.access !== "api") return instance.displayName;
  return instance.displayName.replace(/\s*\((?:API key|API)\)$/i, "") || instance.displayName;
}

export function modelName(instance: InstanceInfo | undefined, model: string): string {
  if (model === "hermes-default" && !instance) return t("model.simple.unavailable");
  const option = modelOptionForId(instance, model);
  if (instance && isHermesHarness(instance)) return option?.label ?? (model === "hermes-default" ? t("model.simple.unavailable") : model);
  if (instance && isDaniFreeInstance(instance)) return option ? daniModelLabel(option) : t("daniSetup.unavailableModel");
  if (!instance || !option) return model;
  return displayModelLabel(option.label, providerName(instance), option.custom);
}

export function repeatedModelLabels(options: readonly ModelOption[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const option of options) (seen.has(option.label) ? repeated : seen).add(option.label);
  return repeated;
}

function listedModels(instance: InstanceInfo) {
  const signedOut = !isCustomOnly(instance) && needsSignIn(instance);
  const own = isCustomOnly(instance) || signedOut ? [] : modelChoices(instance, instance.models.options.filter((option) => !option.custom));
  const local = partitionCustomModels(instance.models.options.filter((option) => option.custom));
  return { signedOut, own, all: [...own, ...local.pinned, ...local.rest] };
}

function localFrom(rows: readonly MenuModelRow[], mixed: boolean): number | null {
  if (!mixed) return null;
  const first = rows.findIndex((row) => row.option.custom);
  return first >= 0 && rows.slice(first).every((row) => row.option.custom) ? first : null;
}

function heading(instance: InstanceInfo, listed: readonly InstanceInfo[]): Pick<MenuGroup, "label" | "provider" | "account"> {
  const provider = providerName(instance);
  const family = signInFamily(instance);
  if (instance.access === "api") return { label: `${provider} · ${t("model.simple.apiKey")}`, provider };
  const several = family !== undefined && listed.filter((other) => signInFamily(other) === family).length > 1;
  const account = several && instance.displayName !== provider ? instance.displayName : undefined;
  return { label: account ? `${provider} · ${account}` : provider, provider, account };
}

function currentRow(input: SimpleMenuInput): MenuCurrent {
  const { instances, selection, bot, loading } = input;
  const active = instances.find((instance) => instance.instanceId === selection.instanceId);
  const option = modelOptionForId(active, selection.model);
  const free = active ? isDaniFreeInstance(active) : DANI_FREE_INSTANCE_IDS[selection.instanceId] === true;
  const name = free ? (option ? daniModelLabel(option) : t("daniSetup.unavailableModel")) : option?.label ?? (selection.model === "hermes-default" ? t("model.simple.unavailable") : selection.model);
  const provider = active && isHermesHarness(active) ? option?.provider ?? providerName(active) : active ? free ? providerName(active) : active.displayName : undefined;
  const row = { instance: active, provider, label: free ? name : modelName(active, selection.model), title: provider ? `${provider} · ${name}` : name, warning: false, pending: false };
  if (!active) return loading ? { ...row, pending: true } : { ...row, meta: t("model.simple.unavailable"), warning: true };
  if (!option && input.refreshing === active.instanceId) return { ...row, pending: true };
  if (option?.availability !== undefined && option.availability !== "available") return { ...row, meta: option.unavailableReason ?? t("model.simple.unavailable"), warning: true, blocked: true };
  if (free && !option) return { ...row, meta: t("model.simple.unavailable"), warning: true };
  if (option?.orgBlocked) return { ...row, meta: t("model.orgBlocked"), warning: true, blocked: true };
  if (active.policy) return { ...row, meta: t("policy.managedBy", { organization: active.policy.organizationName }), warning: true };
  if (needsCli(active)) return { ...row, meta: t("model.setupRequired"), warning: true };
  if (needsSignIn(active) && !isCustomOnly(active) && !option?.custom) return { ...row, meta: t("model.signInRequired"), warning: true };
  if (bot.follows === true) return { ...row, meta: t("model.simple.botsModel", { name: bot.name }) };
  if (free) return row;
  const family = signInFamily(active);
  const accounts = family ? instances.filter((instance) => signInFamily(instance) === family).length : 0;
  if (accounts > 1 || active.snapshot.chatgptPlan) return { ...row, meta: active.displayName };
  return option?.provider ? { ...row, meta: option.provider } : row;
}

export function simpleModelMenu(input: SimpleMenuInput): SimpleMenu {
  const { listed, selection, bot, expanded, probing } = input;
  const models = new Map(listed.map((instance) => [instance.instanceId, listedModels(instance)]));
  const total = listed.filter((instance) => !instance.policy && !needsCli(instance))
    .reduce((sum, instance) => sum + models.get(instance.instanceId)!.all.length, 0);
  const search = listed.some(isHermesHarness) || total > SIMPLE_SEARCH_AFTER || listed.some((instance) => takesTypedModels(instance) && !instance.policy && !needsCli(instance));
  const query = search ? input.query.trim() : "";
  const { subscription, api, custom } = splitEngineRail(listed);
  const ordered = [...subscription, ...api, ...custom];
  const current = ordered.find((instance) => instance.instanceId === selection.instanceId);

  function groupBody(instance: InstanceInfo, provider: string): MenuGroupBody | null {
    if (instance.policy) return query ? null : { kind: "policy", organization: instance.policy.organizationName, ...(instance.policy.team ? { team: true } : {}) };
    if (needsCli(instance)) return query ? null : { kind: "setUp" };
    const { signedOut, own, all } = models.get(instance.instanceId)!;
    if (all.length === 0) return query ? null : signedOut ? { kind: "signIn" } : { kind: "empty", loading: input.refreshing === instance.instanceId };
    const currentSelection = instance.instanceId === selection.instanceId ? selection : undefined;
    const repeated = repeatedModelLabels(all);
    const botSelection = bot.follows === false && bot.selection.instanceId === instance.instanceId ? bot.selection : undefined;
    const row = (option: ModelChoice): MenuModelRow => ({
      option,
      ...(option.nativeModel ? { model: option.nativeModel } : {}),
      ...(option.variant ? { variant: option.variant } : {}),
      label: shortModelLabel(option.label, provider),
      ...(repeated.has(option.label) && option.provider ? { route: option.provider } : {}),
      current: currentSelection ? choiceIsSelected(option, currentSelection) : false,
      blocked: option.orgBlocked === true,
    });
    const mixed = own.length > 0 && own.length < all.length;
    if (query) {
      const rows = filterCustomModels(all, query).map(row);
      return rows.length === 0 ? null
        : { kind: "models", rows, total: all.length, toggle: null, localFrom: localFrom(rows, mixed), signInForOwn: false, probing: false };
    }
    const others = all.filter((option) => (!currentSelection || !choiceIsSelected(option, currentSelection))
      && (!botSelection || !choiceIsSelected(option, botSelection)));
    const suggested = suggestedModels(others, instance.models.default, undefined,
      currentSelection === undefined ? GROUP_SUGGESTIONS : CURRENT_GROUP_SUGGESTIONS);
    const rest = others.filter((option) => !suggested.includes(option));
    const open = expanded.has(instance.instanceId) || rest.length === 1;
    const rows = (open ? [...suggested, ...rest] : suggested).map(row);
    const looking = probing.has(instance.instanceId) && own.length === all.length;
    if (rows.length === 0 && !signedOut && !looking) return null;
    return {
      kind: "models", rows, total: all.length,
      toggle: rest.length > 1 ? (expanded.has(instance.instanceId) ? "less" : "more") : null,
      localFrom: localFrom(rows, mixed), signInForOwn: signedOut, probing: looking,
    };
  }

  function providerGroups(instance: InstanceInfo): MenuGroup[] {
    const displaySelection = isHermesHarness(instance) && selection.model === "hermes-default" ? { ...selection, model: instance.models.default } : selection;
    const providers = new Map<string, ModelChoice[]>();
    for (const option of modelChoices(instance, instance.models.options)) {
      if (isHermesHarness(instance) && option.id === "hermes-default") continue;
      const provider = option.provider || providerName(instance);
      const options = providers.get(provider) ?? [];
      options.push(option);
      providers.set(provider, options);
    }
    return [...providers].flatMap(([provider, options]): MenuGroup[] => {
      if (instance.policy && isHermesHarness(instance)) return query ? [] : [{ instance, label: provider, provider,
        body: { kind: "policy", organization: instance.policy.organizationName, ...(instance.policy.team ? { team: true } : {}) } }];
      const filtered = query && !provider.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? filterCustomModels(options, query) : options;
      const currentId = instance.instanceId === selection.instanceId ? options.find((option) => choiceIsSelected(option, displaySelection))?.id : undefined;
      const suggested = suggestedModels(options, instance.models.default, currentId, GROUP_SUGGESTIONS);
      const rest = options.filter((option) => !suggested.includes(option));
      const expandedProvider = expanded.has(`${instance.instanceId}/${provider}`);
      const shown = query ? filtered : !isHermesHarness(instance) || expandedProvider || rest.length <= 1 ? options : suggested;
      const rows = shown.map((option): MenuModelRow => ({
        instance, option, label: isDaniFreeInstance(instance) ? daniModelLabel(option) : option.label,
        ...(option.nativeModel ? { model: option.nativeModel } : {}),
        ...(option.variant ? { variant: option.variant } : {}),
        current: instance.instanceId === selection.instanceId && choiceIsSelected(option, displaySelection),
        blocked: Boolean(instance.policy) || option.orgBlocked === true,
        unavailable: needsCli(instance) || needsSignIn(instance) || (option.availability !== undefined && option.availability !== "available"),
      }));
      return rows.length ? [{ instance, label: provider, provider,
        body: { kind: "models", rows, total: options.length,
          toggle: !query && isHermesHarness(instance) && rest.length > 1 ? expandedProvider ? "less" : "more" : null,
          localFrom: null, signInForOwn: false, probing: false,
          ...(!isHermesHarness(instance) && !instance.policy && rows.some((row) => row.unavailable) ? { unavailableRoutes: [instance] } : {}) } }] : [];
    });
  }

  const groups = (current ? [current, ...ordered.filter((instance) => instance !== current)] : ordered).flatMap((instance): MenuGroup[] => {
    if (isHermesHarness(instance) || isDaniFreeInstance(instance)) return providerGroups(instance);
    const named = heading(instance, listed);
    const body = groupBody(instance, named.provider);
    return body ? [{ instance, ...named, body }] : [];
  });


  return {
    current: query ? null : currentRow(input),
    follow: !query && bot.follows === false,
    groups,
    search,
    query,
    results: query ? groups.reduce((sum, group) => sum + (group.body.kind === "models" ? group.body.rows.length : 0), 0) : null,
    empty: listed.length > 0 ? null : input.loading ? "loading" : "none",
    busy: input.loading || input.refreshing != null,
  };
}
