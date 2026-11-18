import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ModelCatalog } from "../../contracts.ts";
import type { CatalogProviders } from "../../model-catalog/trim.ts";
import { harnessHome } from "../../env-path.ts";
import { decodeInjectId, localHost } from "../local-inject.ts";
import type { DaniFreeSource } from "../dani-free-catalog.ts";
import { isHermesModelRoute } from "../../../shared/hermes-harness.ts";

export const HERMES_CONFIG_MODEL_ID = "hermes-default";
type ModelOption = ModelCatalog["options"][number];
export interface NativeModelProvider {
  id: string;
  label: string;
  models: string[];
  authenticatedModels: string[];
  toolModels?: string[];
  credentialEnv?: string[];
  unavailableReason?: string;
  unavailableModels?: Record<string, string>;
  toolDiscardingProxy?: boolean;
}
export interface NativeModelMetadata { providers: NativeModelProvider[] }
export interface HermesConfiguredRoute { model: string; provider: string; toolDiscardingProxy?: boolean }
export interface FreeModelSource { source: DaniFreeSource; catalog: ModelCatalog }

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Claude", claude: "Claude", "openai-codex": "Codex", codex: "Codex",
  opencode: "OpenCode", "opencode-zen": "OpenCode", "opencode-go": "OpenCode Go",
  kilocode: "Kilo Code", kilo: "Kilo Code", xai: "xAI", "xai-oauth": "xAI OAuth",
  openai: "OpenAI", openrouter: "OpenRouter", nous: "Nous", "dani-free": "Dani Free",
  auto: "Provider not configured",
};
const PROVIDER_ROUTES: Record<string, string> = {
  opencode: "opencode-zen", kilo: "kilocode", "github-copilot": "copilot", google: "gemini",
  "google-vertex": "vertex", "vercel": "ai-gateway", "togetherai": "togetherai",
  openai: "openai-api",
  "fireworks-ai": "fireworks", "zhipuai": "zai", "zai-coding-plan": "zai",
};
const MODEL_ID = /^[\w][\w./:+@-]*$/;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
export const hermesProviderLabel = (id: string, fallback = id): string => PROVIDER_NAMES[id.replace(/^custom:/, "")] || fallback;

export function decodeNativeModelMetadata(value: unknown): NativeModelMetadata {
  const providers = record(value).providers;
  if (!Array.isArray(providers)) return { providers: [] };
  const result: NativeModelProvider[] = [];
  for (const value of providers) {
    const row = record(value);
    const id = text(row.id);
    if (!/^(?:custom:)?[a-z0-9_.-]+$/i.test(id)) continue;
    const models = Array.isArray(row.models) ? row.models.filter((model): model is string => typeof model === "string" && MODEL_ID.test(model)) : [];
    const authenticatedModels = Array.isArray(row.authenticatedModels) ? row.authenticatedModels.filter((model): model is string => typeof model === "string" && models.includes(model)) : [];
    const toolModels = Array.isArray(row.toolModels) ? row.toolModels.filter((model): model is string => typeof model === "string" && models.includes(model)) : undefined;
    const credentialEnv = Array.isArray(row.credentialEnv) ? row.credentialEnv.filter((name): name is string => typeof name === "string" && /^[A-Z][A-Z0-9_]*$/.test(name)) : undefined;
    const unavailableModels: Record<string, string> = {};
    for (const [model, reason] of Object.entries(record(row.unavailableModels))) {
      if (models.includes(model) && typeof reason === "string") unavailableModels[model] = reason;
    }
    result.push({ id, label: text(row.label) || id, models, authenticatedModels,
      ...(toolModels ? { toolModels } : {}), ...(credentialEnv ? { credentialEnv } : {}),
      ...(Object.keys(unavailableModels).length ? { unavailableModels } : {}),
      ...(text(row.unavailableReason) ? { unavailableReason: text(row.unavailableReason) } : {}),
      ...(row.toolDiscardingProxy === true ? { toolDiscardingProxy: true } : {}),
    });
  }
  return { providers: result };
}

/** Read the configured native route without resolving credentials, mutating config or starting an agent. */
export function readHermesConfiguredRoute(env: Record<string, string | undefined>): HermesConfiguredRoute | null {
  try {
    const config = record(parseYaml(readFileSync(join(env.HERMES_HOME || harnessHome("hermes", env), "config.yaml"), "utf8")));
    const modelConfig = record(config.model);
    const candidate = typeof config.model === "string" ? config.model : modelConfig.default ?? modelConfig.model ?? modelConfig.name;
    const nested = record(candidate);
    const model = text(candidate) || text(nested.model) || text(nested.default);
    let provider = text(modelConfig.provider) || text(config.provider);
    if (!provider || provider === "auto") provider = text(nested.provider) || provider;
    // Auto is not an execution route; never silently authorize a different paid provider.
    if (!model) return null;
    if (!provider || provider === "auto") provider = "auto";
    let toolDiscardingProxy = false;
    if (provider.startsWith("custom:")) {
      const host = record(record(config.providers)[provider.slice(7)]);
      const endpoint = text(host.api) || text(host.url) || text(host.base_url);
      if (host.enabled === false || !/^https?:\/\//.test(endpoint)) return null;
      const url = new URL(endpoint);
      toolDiscardingProxy = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port === "4187";
    } else if (["custom", "ollama", "vllm", "llamacpp", "lmstudio"].includes(provider)) {
      return null; // Existing local injection owns these concrete model routes.
    }
    return { model, provider, ...(toolDiscardingProxy ? { toolDiscardingProxy } : {}) };
  } catch {
    return null;
  }
}

export function hermesConfiguredOption(route: HermesConfiguredRoute): ModelOption {
  return { id: `${route.provider}:${route.model}`, label: route.model, provider: hermesProviderLabel(route.provider), custom: true };
}

export function buildHermesModelCatalog(
  native: NativeModelMetadata,
  configured: HermesConfiguredRoute | null,
  local: ModelCatalog,
  repository: CatalogProviders,
  free: readonly FreeModelSource[],
  extra: readonly ModelOption[] = [],
): ModelCatalog {
  const options: ModelOption[] = [];
  const positions = new Map<string, number>();
  const nativeProviders = new Set(native.providers.map(provider => provider.id));
  const authenticated = new Set<string>(native.providers.flatMap(provider => provider.authenticatedModels.map(model => `${provider.id}:${model}`)));
  const toolModels = new Set<string>(native.providers.flatMap(provider => (provider.toolModels ?? []).map(model => `${provider.id}:${model}`)));
  const blocked = new Map<string, string>(native.providers.flatMap(provider => Object.entries(provider.unavailableModels ?? {}).map(([model, reason]) => [`${provider.id}:${model}`, reason] as const)));
  for (const provider of Object.values(repository)) {
    const route = PROVIDER_ROUTES[provider.id] || provider.id;
    for (const model of Object.values(provider.models)) if (model.tool_call) toolModels.add(`${route}:${model.id}`);
  }
  for (const source of free) for (const model of source.catalog.options) {
    if (model.tools) toolModels.add(source.source === "kilo" ? `kilocode:${model.id}` : `opencode-zen:${model.id.replace(/^opencode\//, "")}`);
  }
  const defaultRoute = configured ? `${configured.provider}:${configured.model}` : "";
  const add = (option: ModelOption) => {
    if (positions.has(option.id)) return;
    positions.set(option.id, options.length);
    options.push(option);
  };
  const readiness = (id: string): Pick<ModelOption, "availability" | "unavailableReason"> => blocked.has(id)
    ? { availability: "unavailable", unavailableReason: blocked.get(id) }
    : authenticated.has(id) && toolModels.has(id) ? { availability: "available" }
      : { availability: "unavailable", unavailableReason: "Native provider authentication, model access and tool support have not been confirmed. No alternate provider will be used." };
  if (configured) {
    const proxy = configured.toolDiscardingProxy;
    const configuredNative = native.providers.find(provider => provider.id === configured.provider);
    options.push({ ...hermesConfiguredOption(configured), ...readiness(defaultRoute),
      provider: hermesProviderLabel(configured.provider, configuredNative?.label),
      ...(toolModels.has(defaultRoute) ? { tools: true } : {}),
      ...(configuredNative?.unavailableReason ? { availability: "unavailable", unavailableReason: configuredNative.unavailableReason } : {}),
      ...(proxy ? { tools: false, availability: "unavailable", unavailableReason: "This agent proxy discards tool calls and cannot execute root model requests." } : {}),
    });
    positions.set(defaultRoute, 0);
  }
  for (const provider of native.providers) {
    for (const model of provider.models) {
      const id = `${provider.id}:${model}`;
      add({ id, label: model, provider: hermesProviderLabel(provider.id, provider.label), custom: true,
        ...readiness(id), ...(toolModels.has(id) ? { tools: true } : {}),
        ...(provider.unavailableReason ? { availability: "unavailable", unavailableReason: provider.unavailableReason } : {}),
        ...(provider.toolDiscardingProxy ? { tools: false, availability: "unavailable", unavailableReason: "This agent proxy discards tool calls and cannot execute root model requests." } : {}),
      });
    }
  }
  for (const provider of Object.values(repository)) {
    const route = PROVIDER_ROUTES[provider.id] || provider.id;
    for (const model of Object.values(provider.models)) {
      const id = `${route}:${model.id}`;
      add({ id, label: model.name, provider: hermesProviderLabel(route, provider.name), custom: true,
        tools: model.tool_call, imageInput: model.modalities.input.includes("image"),
        ...(model.limit ? { contextWindow: model.limit.context } : {}),
        ...readiness(id),
        ...(!nativeProviders.has(route) ? { availability: "unavailable", unavailableReason: "This provider has no configured native API route. Configure a native provider endpoint before selecting it." } : {}),
      });
    }
  }
  for (const option of extra) {
    const position = positions.get(option.id);
    if (option.availability && position !== undefined) options[position] = { ...options[position], ...option, custom: true };
    else add({ ...option, ...(option.availability ? {} : readiness(option.id)), custom: true });
  }
  for (const { source, catalog } of free) {
    for (const option of catalog.options) {
      const model = source === "opencode" ? option.id.replace(/^opencode\//, "") : option.id;
      add({ ...option, id: `dani-free:${source}:${model}`, provider: "Dani Free", custom: true, availability: "unavailable",
        unavailableReason: option.unavailableReason || "Free catalog eligibility does not establish native authentication or entitlement. Restricted client-only routes and paid-key fallback are not permitted." });
    }
  }
  for (const option of local.options) {
    const inject = decodeInjectId(option.id);
    const current = { ...option, id: inject ? `custom:${inject.host}:${inject.model}` : option.id,
      provider: option.provider || (inject ? localHost(inject.host)?.label : undefined) || "Local", custom: true,
      availability: option.availability ?? "available" as const, unavailableReason: option.unavailableReason };
    const position = positions.get(current.id);
    if (position === undefined) add(current);
    else options[position] = current;
  }
  for (const option of options) {
    const reason = blocked.get(option.id);
    if (reason || !isHermesModelRoute(option.id)) {
      option.availability = "unavailable";
      option.unavailableReason = reason || "This model identifier is not supported by the native provider route.";
    }
  }
  const localDefault = decodeInjectId(local.default);
  return { default: defaultRoute || (localDefault ? `custom:${localDefault.host}:${localDefault.model}` : local.default) || options.find(option => option.availability === "available")?.id || options[0]?.id || "", options };
}

export function requireHermesModelSelection(model: string, catalog: ModelCatalog): void {
  const selected = catalog.options.find(option => option.id === model);
  if (!selected) throw new Error("The selected model is not in the current provider catalog. Refresh and choose an available model.");
  if (selected.availability === "unavailable" || selected.availability === "preparing" || selected.orgBlocked) {
    throw new Error(selected.unavailableReason || "The selected model is unavailable for this account.");
  }
}
