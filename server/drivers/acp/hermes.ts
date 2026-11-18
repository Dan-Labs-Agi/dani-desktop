// Hermes is the root execution harness. Catalog choices are native API-provider routes, never other agents.
// Local injections bind custom:<host>:<model>; hosted selections and the saved follow-profile source
// are authorized from read-only metadata and explicitly applied before every prompt.
import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { isMap, parseDocument } from "yaml";
import { writeFileAtomic } from "../../atomic.ts";

import type { ModelCatalog } from "../../contracts.ts";
import { findCliCandidates, harnessHome, sealedFixture } from "../../env-path.ts";
import { resolveCli } from "../../procs.ts";
import { DATA_DIR, loadConfig } from "../../config.ts";
import { ModelCatalogStore } from "../../model-catalog/catalog.ts";
import { DaniFreeCatalog, type DaniFreeSource } from "../dani-free-catalog.ts";
import { STATIC_CODEX_MODELS } from "../codex-catalog.ts";
import { readClaudeModelCatalog } from "../claude.ts";
import {
  buildHermesModelCatalog, decodeNativeModelMetadata, hermesConfiguredOption, readHermesConfiguredRoute,
  requireHermesModelSelection, HERMES_CONFIG_MODEL_ID, type NativeModelMetadata, type FreeModelSource,
} from "./hermes-model-catalog.ts";
export { HERMES_CONFIG_MODEL_ID } from "./hermes-model-catalog.ts";
import { SERVER_ROOT } from "../../proxy-paths.ts";
import { narrowsNativeTools, parseToolScope } from "../../../shared/tool-scope.ts";
import { isHermesModelRoute } from "../../../shared/hermes-harness.ts";
import { DANI_FREE_INSTANCE_ID, DANI_FREE_CLIENT_INSTANCE_ID } from "../../../shared/dani-free.ts";
import { decodeInjectId, hostApiKey, localHost, mergeLocalInject } from "../local-inject.ts";
import { createAcpDriver, type AcpSupport } from "./core.ts";
import { discoverHermesConfiguredApiModels, readHermesConfiguredApiRoutes, type HermesConfiguredApiRoute } from "./hermes-configured-providers.ts";
import { hermesManagedProfile, HERMES_NATIVE_CREDENTIAL_ENV } from "./hermes-provider-env.ts";
import { forgetHermesQualifications, requireHermesQualification } from "./hermes-qualification.ts";

const EMPTY: ModelCatalog = { default: "", options: [] };
const HERMES_BROWSER_POLICY = "DANI_HERMES_BROWSER_POLICY";
const HERMES_INSTANCE_ENV = "DANI_HERMES_INSTANCE_ID";
const HERMES_INITIAL_MODEL_ENV = "DANI_HERMES_INITIAL_MODEL";
const HERMES_BOOTSTRAP = join(SERVER_ROOT, "drivers", "acp", "hermes-bootstrap.py");
const HERMES_INSTALLATION_REASON = "The local agent installation is missing or incompatible. Open Settings → Model providers to repair it, then try again.";

/** Narrow supported contract, not a claim of arbitrary native-tool filtering. */
export function hermesBrowserOnlyScope(value: unknown): boolean {
  const parsed = parseToolScope(value);
  const allow = parsed.ok ? parsed.scope?.allow : undefined;
  return Boolean(allow?.length && allow.every((selector) => selector.startsWith("mcp:browser:")));
}

export const HERMES_OPENMAUS_SCREENSHOT_COMPAT = "HERMES_OPENMAUS_SCREENSHOT_COMPAT";
export const HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL = "HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL";

export function bindHermesScreenshotCompat(
  env: Record<string, string | undefined>,
  modelId: string | null | undefined,
): void {
  delete env[HERMES_OPENMAUS_SCREENSHOT_COMPAT];
  delete env[HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL];
  const inject = decodeInjectId(modelId);
  if (!inject) return;
  env[HERMES_OPENMAUS_SCREENSHOT_COMPAT] = "1";
  env[HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL] = inject.model;
}

function upsertHermesProvider(text: string, hostId: string, provider: Record<string, unknown>): string {
  const document = parseDocument(text);
  if (document.errors.length || (document.contents && !isMap(document.contents))) {
    throw new Error("The native profile configuration is invalid; it will not be overwritten.");
  }
  const providers = document.get("providers", true);
  if (providers !== undefined && !isMap(providers)) {
    throw new Error("The native provider configuration is not a mapping; it will not be overwritten.");
  }
  document.setIn(["providers", hostId], provider);
  return document.toString();
}

export function ensureHermesInjectProvider(
  modelId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const inject = decodeInjectId(modelId);
  if (!inject) return modelId;
  const host = localHost(inject.host);
  if (!host) return modelId;

  const dir = env.HERMES_HOME || harnessHome("hermes", env);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.yaml");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  const next = upsertHermesProvider(text, inject.host, { base_url: host.baseUrl, api_key: hostApiKey(host, env), api_mode: "chat_completions" });
  if (next !== text) writeFileAtomic(path, next, { mode: 0o600 });
  return hermesAcpModelId(modelId) ?? modelId;
}

/** ACP session/set_model id; Hermes parse_model_input reads `custom:name:model`. */
export function hermesAcpModelId(modelId: string | null | undefined): string | null {
  const inject = decodeInjectId(modelId);
  if (inject) return `custom:${inject.host}:${inject.model}`;
  // Hermes' own ACP ids are `<provider>:<model>` (`openrouter:qwen/qwen3.8-max`), forwarded untouched.
  const native = typeof modelId === "string" ? modelId.trim() : "";
  if (isHermesModelRoute(native)) return native;
  return null;
}

/** The saved default is an internal selection source; normal catalog labels show only its actual model. */
export function hermesConfiguredModel(
  env: Record<string, string | undefined> = process.env,
): ModelCatalog["options"][number] | null {
  const route = readHermesConfiguredRoute(env);
  return route ? hermesConfiguredOption(route) : null;
}

export const HERMES_ACP_MODELS_TIMEOUT_ENV = "HERMES_ACP_MODELS_TIMEOUT_MS";
export const HERMES_ACP_MODELS_DEFAULT_TIMEOUT_MS = 15_000;
const execFileAsync = promisify(execFile);
const repositoryModels = new ModelCatalogStore({ dataDir: DATA_DIR, fetchDisabled: true });
interface ResolvedHermesCatalog {
  catalog: ModelCatalog;
  defaultRoute: string | null;
  native: NativeModelMetadata;
  apiRoutes: HermesConfiguredApiRoute[];
  credentialEnv: ReadonlySet<string>;
  localInjects: ReadonlyMap<string, string>;
}
const resolvedCatalogs = new Map<string, ResolvedHermesCatalog>();

function managedHermesPython(cli: string, env: Record<string, string | undefined>): string | undefined {
  if (process.platform === "win32") return undefined;
  const resolved = resolveCli(cli, [], env);
  if (resolved.args.length) return undefined;
  let command: string | undefined;
  for (const candidate of findCliCandidates(resolved.command, env.PATH)) {
    try {
      accessSync(candidate, constants.X_OK);
      if (!statSync(candidate).isFile()) continue;
    } catch { continue; }
    if (!isAbsolute(candidate)) return undefined;
    try { command = realpathSync(candidate); } catch { return undefined; }
    break;
  }
  if (!command || basename(command) !== "hermes" || basename(dirname(command)) !== "bin") return undefined;
  const python = join(dirname(command), "python3");
  try {
    accessSync(python, constants.X_OK);
    return statSync(python).isFile() ? python : undefined;
  } catch { return undefined; }
}

/** Metadata-only Python entrypoint: no ACP session/new, agent construction, tool discovery or MCP launch. */
export async function fetchHermesNativeModels(
  cli: string,
  env: Record<string, string | undefined>,
): Promise<NativeModelMetadata> {
  try {
    const python = managedHermesPython(cli, env);
    if (!python) return { providers: [] };
    const timeout = Number(env[HERMES_ACP_MODELS_TIMEOUT_ENV]);
    const freeModels = Object.values(repositoryModels.get().providers.opencode?.models ?? {})
      .filter(model => model.cost?.input === 0 && model.cost.output === 0).map(model => model.id);
    const { stdout } = await execFileAsync(python, [join(SERVER_ROOT, "drivers", "acp", "hermes-model-metadata.py")], {
      env: { ...env, PYTHONDONTWRITEBYTECODE: "1", DANI_HERMES_OPENCODE_FREE_MODELS: JSON.stringify(freeModels) }, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      timeout: Number.isInteger(timeout) && timeout >= 1 && timeout <= 2_147_483_647 ? timeout : HERMES_ACP_MODELS_DEFAULT_TIMEOUT_MS,
    });
    return decodeNativeModelMetadata(JSON.parse(stdout));
  } catch {
    return { providers: [] };
  }
}

async function resolveModels(
  env: Record<string, string | undefined>,
  config?: { cli?: string },
): Promise<ModelCatalog> {
  const isolated = sealedFixture();
  const freeCatalogs: FreeModelSource[] = [];
  const apiRoutes = isolated ? [] : readHermesConfiguredApiRoutes(env, loadConfig());
  const readFree = async (source: DaniFreeSource) => {
    const catalog = new DaniFreeCatalog(source, source === "kilo" ? DANI_FREE_INSTANCE_ID : DANI_FREE_CLIENT_INSTANCE_ID, { scheduleRefresh: false });
    try {
      await catalog.startup;
      freeCatalogs.push({ source, catalog: catalog.models });
    } finally {
      await catalog.dispose();
    }
  };
  const [native, local, apiOptions] = await Promise.all([
    isolated ? Promise.resolve({ providers: [] }) : fetchHermesNativeModels(config?.cli || "hermes", env),
    isolated ? Promise.resolve(EMPTY) : mergeLocalInject(EMPTY, env),
    discoverHermesConfiguredApiModels(apiRoutes, fetch, isolated ? {} : repositoryModels.get().providers),
    ...(isolated ? [] : [readFree("kilo"), readFree("opencode")]),
  ]);
  if (!hermesManagedProfile(env)) for (const option of [...apiOptions, ...local.options]) {
    option.availability = "unavailable";
    option.unavailableReason = "Configured proxies require an isolated native profile; the global profile will not be changed.";
  }
  freeCatalogs.sort((a, b) => a.source.localeCompare(b.source));
  const configured = readHermesConfiguredRoute(env);
  const extra = [
    ...STATIC_CODEX_MODELS.options.map(option => ({ ...option, id: `openai-codex:${option.id}`, provider: "Codex" })),
    ...readClaudeModelCatalog(env).options.map(option => ({ ...option, id: `anthropic:${option.id}`, provider: "Claude" })),
    ...apiOptions,
  ];
  const catalog = buildHermesModelCatalog(native, configured, local, isolated ? {} : repositoryModels.get().providers, freeCatalogs, extra);
  const localInjects = new Map<string, string>();
  for (const option of local.options) {
    const nativeId = hermesAcpModelId(option.id);
    if (nativeId) localInjects.set(nativeId, option.id);
  }
  resolvedCatalogs.set(env[HERMES_INSTANCE_ENV] || "", {
    catalog, defaultRoute: configured ? `${configured.provider}:${configured.model}` : null, native, apiRoutes,
    credentialEnv: new Set([...HERMES_NATIVE_CREDENTIAL_ENV, ...native.providers.flatMap(provider => provider.credentialEnv ?? [])]),
    localInjects,
  });
  return catalog;
}

async function applySetting(
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>,
  method: string,
  params: Record<string, unknown>,
  what: string,
) {
  try {
    await request(method, params);
  } catch (e) {
    throw new Error(`Hermes rejected ${what} via ${method}: ${(e as Error).message}`);
  }
}

const support: AcpSupport = {
  driverKind: "hermesAgent",
  displayName: "Hermes",
  access: "custom",
  models: EMPTY,
  disposeModelCatalog: (instanceId) => { resolvedCatalogs.delete(instanceId); forgetHermesQualifications(instanceId); },
  resolveModels: (env, config) => resolveModels(env, config),
  startupModelCache: false,
  async snapshot(env, config) {
    const python = managedHermesPython(config.cli, env);
    if (!python) return { state: "unavailable", reason: HERMES_INSTALLATION_REASON };
    try {
      const { stdout } = await execFileAsync(python, [HERMES_BOOTSTRAP, "--version"], {
        env: { ...env, PYTHONDONTWRITEBYTECODE: "1" }, windowsHide: true, timeout: 8000, maxBuffer: 4096,
      });
      if (stdout.trim() === "0.21.3") return { state: "available", version: "0.21.3", authenticated: true };
    } catch {
      return { state: "unavailable", reason: HERMES_INSTALLATION_REASON };
    }
    return { state: "unavailable", reason: HERMES_INSTALLATION_REASON };
  },
  resolveTurnModel: (model, env) => {
    if (model !== HERMES_CONFIG_MODEL_ID && !hermesAcpModelId(model)) {
      throw new Error("Choose a provider-qualified model. This saved model cannot be routed without changing its provider.");
    }
    const resolved = resolvedCatalogs.get(env[HERMES_INSTANCE_ENV] || "");
    if (!resolved || !model) throw new Error("The provider model catalog is unavailable. Refresh before choosing a model.");
    const nativeModel = model === HERMES_CONFIG_MODEL_ID ? resolved.defaultRoute : hermesAcpModelId(model);
    if (!nativeModel) throw new Error("The configured model has no confirmed native provider route.");
    requireHermesModelSelection(nativeModel, resolved.catalog);
    // Never inherit a broad or stale compatibility grant from the parent; bind one concrete model.
    bindHermesScreenshotCompat(env, resolved.localInjects.get(nativeModel) || nativeModel);
    return nativeModel;
  },
  credentialEnv: HERMES_NATIVE_CREDENTIAL_ENV,
  sessionModelEnv: HERMES_INITIAL_MODEL_ENV,
  applyTurnEnv: (env, context) => {
    const resolved = resolvedCatalogs.get(env[HERMES_INSTANCE_ENV] || "");
    const model = context.model ?? resolved?.catalog.default;
    if (!resolved || !model) throw new Error("The provider model catalog is unavailable. Refresh before choosing a model.");
    requireHermesModelSelection(model, resolved.catalog);
    const imported = resolved.apiRoutes.find(route => model.startsWith(`custom:${route.name}:`));
    const native = resolved.native.providers.find(provider => model.startsWith(`${provider.id}:`));
    const allowed = new Set(imported ? [] : native?.credentialEnv ?? []);
    for (const name of resolved.credentialEnv) {
      if (!allowed.has(name)) delete env[name];
    }
    if (imported) {
      if (!hermesManagedProfile(env) || !env.HERMES_HOME) throw new Error("Configured proxy selection requires an app-owned native profile; the global profile will not be changed.");
      if (imported.apiKey) env[imported.keyEnv] = imported.apiKey;
      const modelId = model.slice(`custom:${imported.name}:`.length);
      const prefix = `custom:${imported.name}:`;
      const models = Object.fromEntries(resolved.catalog.options.filter(option => option.id.startsWith(prefix) && option.availability === "available")
        .map(option => [option.id.slice(prefix.length), { supports_tools: true, ...(option.imageInput !== undefined ? { supports_vision: option.imageInput } : {}) }]));
      if (!models[modelId]) throw new Error("The selected proxy model has no authorized native catalog entry.");
      const path = join(env.HERMES_HOME, "config.yaml");
      mkdirSync(env.HERMES_HOME, { recursive: true });
      const current = existsSync(path) ? readFileSync(path, "utf8") : "";
      const next = upsertHermesProvider(current, imported.name, {
        name: imported.label, base_url: imported.baseUrl, api_mode: imported.apiMode,
        ...(imported.apiKey ? { key_env: imported.keyEnv } : {}),
        ...(Object.keys(imported.headers).length ? { extra_headers: imported.headers } : {}),
        ...(imported.extraBody ? { extra_body: imported.extraBody } : {}), models,
      });
      if (next !== current) writeFileAtomic(path, next, { mode: 0o600 });
    } else {
      const inject = resolved.localInjects.get(model);
      if (inject) {
        if (!hermesManagedProfile(env)) throw new Error("Local provider selection requires an app-owned native profile.");
        ensureHermesInjectProvider(inject, env);
      }
    }
  },
  defaultCli: "hermes",
  nativeSource: "hermes.acp",
  loginNote: "The local agent is not installed. Open Settings → Model providers to set it up.",
  install: {
    command: {
      darwin: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      linux: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      win32: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    },
    docsUrl: "https://hermes-agent.nousresearch.com/docs/getting-started/quickstart",
    signInCommand: "hermes setup",
  },
  spawnArgs: (_config, turn) => narrowsNativeTools(turn.toolScope) ? ["--browser-only", "acp"] : ["acp"],
  async resolveCommand(env, config, instanceId, turn, purpose) {
    delete env[HERMES_BROWSER_POLICY];
    delete env[HERMES_INITIAL_MODEL_ENV];
    if (!turn?.model) {
      const selected = resolvedCatalogs.get(env[HERMES_INSTANCE_ENV] || "")?.catalog.default;
      if (!selected) throw new Error("The configured model has no confirmed native provider route.");
      env[HERMES_INITIAL_MODEL_ENV] = selected;
    }
    const narrowed = narrowsNativeTools(turn?.toolScope);
    if (narrowed && !hermesBrowserOnlyScope(turn?.toolScope)) {
      throw new Error("Hermes currently supports narrowed native tools only for explicit browser-only MCP requests.");
    }
    const python = managedHermesPython(config.cli, env);
    if (!python) throw new Error(HERMES_INSTALLATION_REASON);
    const resolved = resolvedCatalogs.get(instanceId);
    const model = turn?.model ?? resolved?.catalog.default;
    if (!resolved || !model) throw new Error("The selected model has no native runtime catalog.");
    const qualification = await requireHermesQualification(instanceId, python, model, env,
      new Set([...resolved.credentialEnv, ...resolved.apiRoutes.map(route => route.keyEnv)]), purpose !== "background");
    env.DANI_HERMES_QUALIFIED_IDENTITY = JSON.stringify(qualification);
    if (narrowed) env[HERMES_BROWSER_POLICY] = "browser-only@0.21.3";
    env.PYTHONDONTWRITEBYTECODE = "1";
    return { command: python, args: [HERMES_BOOTSTRAP] };
  },
  toolScopeSessionParams(turn, _initialize, hasMcp, context) {
    if (!hermesBrowserOnlyScope(turn.toolScope) || !hasMcp || context.env[HERMES_BROWSER_POLICY] !== "browser-only@0.21.3") {
      throw new Error("Hermes browser-only selection requires its qualified native bootstrap and an admitted Dani browser MCP mount.");
    }
    return {};
  },
  // Hermes keeps the first MCP server it registers under a name for the process's life, so a new bearer needs a fresh process.
  restartOnMcpChange: true,
  resendsReasoningReply: true,
  nudgeAnnouncedAction: true,
  transformEnv: (env, _config, instanceId) => {
    env[HERMES_INSTANCE_ENV] = instanceId;
    delete env[HERMES_INITIAL_MODEL_ENV];
    delete env[HERMES_BROWSER_POLICY];
  },
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: () => true,
  async configureSession({ request, sessionId, turn, env }) {
    const resolved = resolvedCatalogs.get(env[HERMES_INSTANCE_ENV] || "");
    const model = turn.model ?? resolved?.catalog.default;
    if (!resolved || !model) throw new Error("The provider model catalog is unavailable. Refresh before choosing a model.");
    // Background text uses the same authorized configured source; never inherit a native session's old provider.
    const native = model === HERMES_CONFIG_MODEL_ID ? resolved.defaultRoute : hermesAcpModelId(model);
    if (!native) throw new Error("The selected provider model has no native API route.");
    requireHermesModelSelection(model === HERMES_CONFIG_MODEL_ID ? native : model, resolved.catalog);
    await applySetting(
      request,
      "session/set_model",
      { sessionId, modelId: native },
      `model "${native}"`,
    );
  },
  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};

export const HermesAgentDriver = createAcpDriver(support);
