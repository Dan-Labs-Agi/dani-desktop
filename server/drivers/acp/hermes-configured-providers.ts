import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { instanceConfigs, type AppConfig } from "../../config.ts";
import { apiSetupHeaders, fetchSetupModels, normalizeApiUrl, type SetupModel } from "../../cli-api-setup.ts";
import type { ModelCatalog } from "../../contracts.ts";
import { isLoopback } from "../../provider-key-check.ts";
import { parseJsonc } from "./opencode-go.ts";
import { parse as parseYaml } from "yaml";
import type { CatalogProviders } from "../../model-catalog/trim.ts";
import { isHermesModelRoute } from "../../../shared/hermes-harness.ts";

export interface HermesConfiguredApiRoute {
  name: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  keyEnv: string;
  apiMode: "chat_completions" | "anthropic_messages" | "codex_responses";
  models: SetupModel[];
  headers: Record<string, string>;
  extraBody?: Record<string, unknown>;
  tools?: boolean;
  allowedModels?: ReadonlySet<string>;
  excludedModels?: ReadonlySet<string>;
  unavailableReason?: string;
  discoveryBlocked?: true;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

function configuredSecret(value: unknown, env: Record<string, string | undefined>): string {
  const raw = text(value);
  if (!raw || raw.startsWith("!")) return ""; // Browsing a catalog never executes credential commands.
  let missing = false;
  const expanded = raw.replace(/\$\$|\$!|\{env:([A-Z][A-Z0-9_]*)\}|\$\{([A-Z][A-Z0-9_]*)\}|\$([A-Z][A-Z0-9_]*)/g, (match, first: string | undefined, second: string | undefined, third: string | undefined) => {
    if (match === "$$") return "$";
    if (match === "$!") return "!";
    const key = first || second || third;
    const value = key ? env[key] : undefined;
    if (!value) missing = true;
    return value || "";
  });
  return missing || expanded.includes("{file:") ? "" : env[raw] ?? expanded;
}

function nativeEndpointIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    const hadQuery = value.split("#", 1)[0]!.includes("?");
    const normalized = url.toString();
    return !hadQuery && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return value;
  }
}

export function readHermesConfiguredApiRoutes(env: Record<string, string | undefined>, app: AppConfig): HermesConfiguredApiRoute[] {
  const routes: HermesConfiguredApiRoute[] = [];
  const seen = new Set<string>();
  const add = (source: string, label: string, raw: Record<string, unknown>, modelRows: unknown, api = "openai-completions") => {
    const endpoint = text(raw.baseUrl) || text(raw.baseURL) || text(raw.url);
    if (!endpoint) return;
    const rawKey = raw.apiKey ?? raw.key;
    const apiKey = configuredSecret(rawKey, env);
    let unresolvedCredential = Boolean(text(rawKey)) && !apiKey;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(object(raw.headers))) {
      const resolved = configuredSecret(value, env);
      if (resolved && /^[\w-]+$/.test(name)) headers[name] = resolved;
      else unresolvedCredential = true;
    }
    if (raw.authHeader === true && apiKey && !Object.keys(headers).some(name => name.toLowerCase() === "authorization")) headers.Authorization = `Bearer ${apiKey}`;
    let baseUrl: string;
    try { baseUrl = normalizeApiUrl(endpoint); } catch { return; }
    const local = isLoopback(new URL(baseUrl).hostname);
    const missingCredential = !apiKey && !local && !Object.keys(headers).some(name => /^(?:authorization|x-api-key)$/i.test(name));
    const identity = `${env.DANI_HERMES_INSTANCE_ID || ""}:${source}:${baseUrl}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const name = `dani-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
    const rows = Array.isArray(modelRows) ? modelRows : Object.entries(object(modelRows)).map(([id, value]) => ({ ...object(value), id }));
    const models: SetupModel[] = [];
    for (const value of rows) {
      const row = object(value);
      const id = typeof value === "string" ? value : text(row.id);
      if (!id || !/^[\w][\w./:+@-]*$/.test(id)) continue;
      const capabilities = object(row.capabilities);
      const tools = typeof row.tools === "boolean" ? row.tools : typeof row.tool_call === "boolean" ? row.tool_call : capabilities.supports_tools;
      const input = row.input ?? object(row.modalities).input;
      const context = row.contextWindow ?? object(row.limit).context;
      models.push({ id, label: text(row.name) || id,
        ...(typeof tools === "boolean" ? { tools } : {}),
        ...(row.orgBlocked === true ? { orgBlocked: true as const } : {}),
        ...(typeof row.privacyNotice === "string" ? { privacyNotice: row.privacyNotice } : {}),
        ...(typeof row.mayTrainOnYourPrompts === "boolean" ? { mayTrainOnYourPrompts: row.mayTrainOnYourPrompts } : {}),
        ...(Array.isArray(input) ? { imageInput: input.includes("image") } : {}),
        ...(typeof context === "number" && Number.isFinite(context) && context > 0 ? { contextWindow: context } : {}),
      });
    }
    const supported = ["openai-completions", "openai-chat-completions", "openai-responses", "anthropic-messages"].includes(api);
    const url = new URL(baseUrl);
    const credentialValues = [apiKey, ...Object.entries(headers).filter(([name]) => /^(?:authorization|x-api-key)$/i.test(name)).map(([, value]) => value.replace(/^Bearer\s+/i, ""))];
    const subscriptionCredential = credentialValues.some(value =>
      (value.startsWith("sk-ant-") && !value.startsWith("sk-ant-api")) ||
      (url.hostname === "api.anthropic.com" && /^(?:eyJ|cc-)/.test(value)));
    const unsupportedHeaderAuth = api === "anthropic-messages" && Object.keys(headers).length > 0;
    const unavailableReason = url.port === "4187" && local
      ? "This agent proxy discards tool calls and cannot execute root model requests."
      : url.port === "4190" && local ? "This router silently fails over even explicit model selectors; fixed model execution is not supported."
      : !supported ? "This configured provider protocol has no supported native API transport."
      : unresolvedCredential || missingCredential ? "The configured credential is unavailable. Resolve its private setting before using this provider."
      : subscriptionCredential ? "Claude subscription credentials cannot be used by this third-party harness. Configure a Claude API key or supported inference provider."
      : unsupportedHeaderAuth ? "This native Anthropic transport cannot preserve configured gateway headers. Use an API-key-authenticated endpoint." : undefined;
    routes.push({ name, label, baseUrl, apiKey, keyEnv: `DANI_HERMES_API_KEY_${name.slice(5).toUpperCase()}`,
      apiMode: api === "openai-responses" ? "codex_responses" : api === "anthropic-messages" ? "anthropic_messages" : "chat_completions",
      models, headers, ...(typeof raw.tools === "boolean" ? { tools: raw.tools } : {}),
      ...(Array.isArray(raw.managedModels) ? { allowedModels: new Set(raw.managedModels.filter((value): value is string => typeof value === "string")) } : {}),
      ...(Array.isArray(raw.excludedModels) ? { excludedModels: new Set(raw.excludedModels.filter((value): value is string => typeof value === "string")) } : {}),
      ...(raw.provider && new URL(baseUrl).hostname === "openrouter.ai" ? { extraBody: { provider: { order: [raw.provider], allow_fallbacks: false } } } : {}),
      ...(unavailableReason ? { unavailableReason } : {}),
      ...(!supported || unresolvedCredential || missingCredential || subscriptionCredential || unsupportedHeaderAuth ? { discoveryBlocked: true as const } : {}),
    });
  };
  const home = env.HOME || env.USERPROFILE || homedir();
  const read = (path: string): Record<string, unknown> => {
    try { return object(parseJsonc(readFileSync(path, "utf8"))); } catch { return {}; }
  };
  const pi = read(join(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "models.json"));
  for (const [id, value] of Object.entries(object(pi.providers))) {
    const provider = object(value);
    const rows = Array.isArray(provider.models) ? provider.models : [];
    const overridden = rows.filter(value => {
      const model = object(value);
      return model.baseUrl !== undefined || model.api !== undefined || model.headers !== undefined;
    });
    const overriddenIds = overridden.map(value => text(object(value).id));
    add(`pi:${id}`, text(provider.name) || id, { ...provider, excludedModels: overriddenIds }, rows.filter(value => !overridden.includes(value)), text(provider.api) || "openai-completions");
    for (const value of overridden) {
      const model = object(value);
      const modelId = text(model.id);
      add(`pi:${id}:model:${modelId}`, text(provider.name) || id,
        { ...provider, baseUrl: model.baseUrl ?? provider.baseUrl, headers: { ...object(provider.headers), ...object(model.headers) }, managedModels: [modelId] },
        [model], text(model.api) || text(provider.api) || "openai-completions");
    }
  }
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
  const files = [join(env.OPENCODE_CONFIG_DIR || join(configHome, "opencode"), "opencode.json"),
    join(env.OPENCODE_CONFIG_DIR || join(configHome, "opencode"), "opencode.jsonc"), join(configHome, "kilo", "kilo.jsonc"),
    ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : [])];
  for (const file of files) {
    const config = read(file);
    const disabled = new Set(Array.isArray(config.disabled_providers) ? config.disabled_providers : []);
    const enabled = Array.isArray(config.enabled_providers) ? new Set(config.enabled_providers) : undefined;
    for (const [id, value] of Object.entries(object(config.provider))) {
      if (disabled.has(id) || (enabled && !enabled.has(id))) continue;
      const provider = object(value);
      const npm = text(provider.npm);
      const api = npm.includes("anthropic") ? "anthropic-messages" : npm && !npm.includes("openai") ? "unsupported" : "openai-completions";
      add(`${file}:${id}`, text(provider.name) || id, object(provider.options), provider.models, api);
    }
  }
  const configuredInstances = instanceConfigs(app);
  for (const id of Object.keys(app.instances ?? {})) {
    const instance = configuredInstances[id];
    if (instance.enabled === false || instance.driver !== "openai-compat") continue;
    const config = object(instance.config);
    const environment = { ...env, ...instance.environment };
    const key = text(config.key) || environment[text(config.apiKeyEnv) || "OPENAI_COMPAT_API_KEY"] || "";
    add(`app:${id}`, instance.displayName || text(config.provider) || id,
      { ...config, apiKey: key, url: config.url || environment.OPENAI_COMPAT_URL },
      Array.isArray(config.managedModels) ? config.managedModels : config.model ? [config.model] : []);
  }
  if (app.openaiCompat?.url) add("workspace:compatible", app.openaiCompat.provider || "Compatible API",
    { ...app.openaiCompat, apiKey: app.openaiCompat.key }, app.openaiCompat.model ? [app.openaiCompat.model] : []);
  if (app.openai?.key) add("workspace:openai", "OpenAI API", { url: "https://api.openai.com/v1", apiKey: app.openai.key }, [], "openai-responses");
  if (app.openrouter?.key) add("workspace:openrouter", "OpenRouter", { url: "https://openrouter.ai/api/v1", apiKey: app.openrouter.key }, []);
  if (app.anthropic?.key || app.anthropic?.url) add("workspace:anthropic", "Claude", { url: app.anthropic.url || "https://api.anthropic.com", apiKey: app.anthropic.key }, [], "anthropic-messages");
  if (app.xai?.key || app.xai?.url) add("workspace:xai", "xAI", { url: app.xai.url || "https://api.x.ai/v1", apiKey: app.xai.key }, [], "openai-responses");
  if (app.groq?.key || app.groq?.url) add("workspace:groq", "Groq", { url: app.groq.url || "https://api.groq.com/openai/v1", apiKey: app.groq.key }, []);
  if (app.meta?.key || app.meta?.url) add("workspace:meta", "Meta", { url: app.meta.url || "https://api.meta.ai/v1", apiKey: app.meta.key }, []);
  if (app.opencodeGo?.apiKey) add("workspace:opencode-go", "OpenCode Go", { url: "https://opencode.ai/zen/go/v1", apiKey: app.opencodeGo.apiKey }, []);
  const peers: Array<{ identity?: string; baseUrl: string; headers: Record<string, unknown>; body: Record<string, unknown> }> =
    routes.map(route => ({ identity: route.name, baseUrl: route.baseUrl, headers: route.headers, body: route.extraBody ?? {} }));
  try {
    const native = object(parseYaml(readFileSync(join(env.HERMES_HOME || join(home, ".hermes"), "config.yaml"), "utf8")));
    const entries: Array<[string, unknown]> = [
      ...Object.entries(object(native.providers)),
      ...(Array.isArray(native.custom_providers) ? native.custom_providers.map((value): [string, unknown] =>
        [text(object(value).provider_key) || text(object(value).name), value]) : []),
    ];
    for (const [identity, value] of entries) {
      const entry = object(value);
      const baseUrl = text(entry.base_url) || text(entry.url) || text(entry.api);
      if (baseUrl && entry.enabled !== false) peers.push({ identity, baseUrl: nativeEndpointIdentity(baseUrl), headers: object(entry.extra_headers), body: object(entry.extra_body) });
    }
  } catch {}
  for (const route of routes) {
    const signature = JSON.stringify([Object.entries(route.headers).map(([name, value]) => [name.toLowerCase(), value]).sort(), route.extraBody ?? {}]);
    if (peers.some(peer => peer.identity !== route.name && peer.baseUrl === route.baseUrl && JSON.stringify([Object.entries(peer.headers).map(([name, value]) => [name.toLowerCase(), value]).sort(), peer.body]) !== signature)) {
      route.unavailableReason = "This endpoint has conflicting configured header or provider-routing identities. The native runtime cannot safely distinguish them.";
      route.discoveryBlocked = true;
    }
  }
  return routes;
}

export async function discoverHermesConfiguredApiModels(routes: readonly HermesConfiguredApiRoute[], fetcher: typeof fetch = fetch, catalog: CatalogProviders = {}): Promise<ModelCatalog["options"]> {
  const groups = await Promise.all(routes.map(async route => {
    let live: SetupModel[] = [];
    let error = route.unavailableReason;
    let freeTier = false;
    if (!route.discoveryBlocked) {
      try { live = await fetchSetupModels(route.baseUrl, route.apiKey, {
        ...(route.apiKey ? {} : { anonymous: true }), fetch: fetcher,
        headers: route.headers,
        ...(route.apiMode === "anthropic_messages" ? { apiMode: "anthropic_messages" } : {}),
      }); }
      catch { error ||= "The configured native API catalog is unreachable or rejected its configured credentials."; }
    }
    live = live.filter(model => (!route.allowedModels || route.allowedModels.has(model.id)) && !route.excludedModels?.has(model.id));
    if (!error && !isLoopback(new URL(route.baseUrl).hostname)) {
      try {
        const url = new URL(route.baseUrl);
        const authUrl = url.hostname === "openrouter.ai" ? "https://openrouter.ai/api/v1/key"
          : ["api.kilo.ai", "ai-gateway.kilo.ai"].includes(url.hostname) ? "https://api.kilo.ai/api/profile"
          : url.hostname === "opencode.ai" ? "https://opencode.ai/zen/go/v1/usage" : undefined;
        const anonymousBase = route.apiMode === "anthropic_messages" && !route.baseUrl.endsWith("/v1") ? `${route.baseUrl}/v1` : route.baseUrl;
        const response = await fetcher(authUrl || `${anonymousBase}/models`, {
          headers: authUrl ? apiSetupHeaders(route.apiKey, route.headers) : {},
          signal: AbortSignal.timeout(5_000), redirect: "error",
        });
        let authorized = authUrl ? response.ok : response.status === 401 || response.status === 403;
        if (authUrl) {
          const payload = object(await response.json());
          freeTier = url.hostname === "openrouter.ai" && object(payload.data).is_free_tier === true;
          if (url.hostname === "opencode.ai" && !url.pathname.includes("/go/") && response.status === 403) authorized = object(payload.error).type === "EntitlementError";
          if (url.hostname === "opencode.ai" && url.pathname.includes("/go/") && response.ok) {
            authorized = !Object.values(object(payload.usage)).some(value => object(value).status === "rate-limited");
          }
        } else {
          await response.body?.cancel();
        }
        if (!authorized) error = "The endpoint has not confirmed the configured credentials or subscription. Public model listing is not authorization.";
      } catch { error = "The endpoint could not confirm the configured credentials without inference."; }
    }
    const liveIds = new Set(live.map(model => model.id));
    const configured = new Map(route.models.map(model => [model.id, model]));
    const endpoint = new URL(route.baseUrl);
    const official = endpoint.hostname === "api.anthropic.com" ? "anthropic" : endpoint.hostname === "api.openai.com" ? "openai"
      : endpoint.hostname === "api.x.ai" ? "xai" : endpoint.hostname === "openrouter.ai" ? "openrouter"
      : ["api.kilo.ai", "ai-gateway.kilo.ai"].includes(endpoint.hostname) ? "kilo"
      : endpoint.hostname === "opencode.ai" ? endpoint.pathname.includes("/go/") ? "opencode-go" : "opencode" : undefined;
    const models = [...live.map(model => {
      const declared = configured.get(model.id);
      const known = official ? catalog[official]?.models[model.id] : undefined;
      return { ...declared, ...model,
        ...(model.tools === undefined && declared?.tools === undefined && known ? { tools: known.tool_call } : {}),
        ...(model.tools === undefined && declared?.tools === undefined && endpoint.hostname === "api.anthropic.com" && route.apiMode === "anthropic_messages" && model.id.startsWith("claude-") ? { tools: true } : {}),
        ...(declared?.tools === false ? { tools: false } : {}),
        ...(declared?.imageInput === false ? { imageInput: false } : {}),
        ...(declared?.orgBlocked ? { orgBlocked: true as const } : {}),
        ...(declared?.contextWindow && model.contextWindow ? { contextWindow: Math.min(declared.contextWindow, model.contextWindow) } : {}),
      };
    }), ...route.models.filter(model => !liveIds.has(model.id))];
    return models.map(model => {
      const tools = route.unavailableReason?.includes("discards tool") || route.tools === false ? false : model.tools ?? route.tools;
      const nativeId = `custom:${route.name}:${model.id}`;
      const unavailableReason = error || (!isHermesModelRoute(nativeId) ? "This model identifier is not supported by the native provider route." : model.orgBlocked ? "The configured provider organization has disabled this model."
        : freeTier && !model.id.endsWith(":free") ? "This account has no paid model entitlement. No paid-key fallback is allowed."
        : endpoint.hostname === "opencode.ai" && (model.id.endsWith("-free") || model.free === true || (catalog.opencode?.models[model.id]?.cost?.input === 0 && catalog.opencode.models[model.id]?.cost?.output === 0))
          ? "This free-tier OpenCode route requires its original client and is unavailable as a direct native model; no paid-key fallback is allowed."
        : !liveIds.has(model.id) ? "The configured endpoint has not advertised this model." : tools !== true ? "The configured proxy has not advertised transparent native tool-call support for this model." : undefined);
      return { id: nativeId, label: model.label, provider: route.label, custom: true,
        ...(typeof tools === "boolean" ? { tools } : {}),
        ...(model.imageInput !== undefined ? { imageInput: model.imageInput } : {}), ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.orgBlocked ? { orgBlocked: true as const } : {}), ...(model.privacyNotice ? { privacyNotice: model.privacyNotice } : {}),
        ...(model.mayTrainOnYourPrompts !== undefined ? { mayTrainOnYourPrompts: model.mayTrainOnYourPrompts } : {}),
        availability: unavailableReason ? "unavailable" as const : "available" as const, ...(unavailableReason ? { unavailableReason } : {}) };
    });
  }));
  return groups.flat();
}
