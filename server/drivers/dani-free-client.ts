import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import type { DriverCreateInput, ModelCatalog, ProviderInstance, TextGenerationOptions, TextGenerationUsage } from "../contracts.ts";
import { installStandaloneEngine } from "../engine-standalone.ts";
import { applyStandaloneSpawnEnv } from "../engine-install.ts";
import { killCliTree, spawnCli } from "../procs.ts";
import { augmentedPath } from "../env-path.ts";
import { runAcpOneShot } from "./acp/background-text.ts";
import { acpModelOption, offeredModels } from "./acp/config-options.ts";
import { writeFileAtomicIfChanged } from "../atomic.ts";
import { createAcpDriver, type AcpConfig, type AcpSupport } from "./acp/core.ts";
import { OPENCODE_STANDALONE } from "./acp/opencode-release.ts";
import { LogTail } from "./acp/quiet-status.ts";
import { activateDaniFree, daniFreeActivated, DaniFreeCatalog, DANI_FREE_REFRESH_MS } from "./dani-free-catalog.ts";

const CHILD_ENV: Readonly<Record<string, true | undefined>> = {
  PATH: true, Path: true, PATHEXT: true, SystemRoot: true, SYSTEMROOT: true, WINDIR: true,
  COMSPEC: true, ComSpec: true, TMP: true, TEMP: true, TMPDIR: true,
  LANG: true, LC_ALL: true, TERM: true, NO_COLOR: true,
  NODE_EXTRA_CA_CERTS: true, SSL_CERT_FILE: true, SSL_CERT_DIR: true, CURL_CA_BUNDLE: true,
  HTTP_PROXY: true, HTTPS_PROXY: true, ALL_PROXY: true, NO_PROXY: true,
  http_proxy: true, https_proxy: true, all_proxy: true, no_proxy: true,
};

export function isolateDaniFreeClientEnvironment(env: Record<string, string | undefined>, root: string, models: ModelCatalog, selected = models.default): void {
  for (const key of Object.keys(env)) if (CHILD_ENV[key] !== true) delete env[key];
  for (const folder of ["home", "config", "data", "cache", "state", "appdata", "localappdata"]) mkdirSync(join(root, folder), { recursive: true, mode: 0o700 });
  const configDir = join(root, "config", "opencode");
  const authDir = join(root, "data", "opencode");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  writeFileAtomicIfChanged(join(authDir, "auth.json"), "{}\n", { mode: 0o600 });
  Object.assign(env, {
    HOME: join(root, "home"), USERPROFILE: join(root, "home"), CFFIXED_USER_HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"),
    OPENCODE_CONFIG_DIR: configDir, OPENCODE_AUTH_CONTENT: "{}", OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      enabled_providers: ["opencode"], autoupdate: false, share: "disabled",
      ...(selected ? { model: selected, small_model: selected } : {}),
      provider: { opencode: { whitelist: models.options.map((model) => model.id.slice("opencode/".length)) } },
      ...(models.options.find((model) => model.id === selected)?.tools === false ? { tools: { "*": false } } : {}),
    }),
  });
}

function describeFreeModelError(limited: boolean): string {
  return limited
    ? "Dani free model usage limit reached. Wait and retry, or choose another available free model."
    : "The selected free model service refused this request. Retry later or choose another available free model.";
}

export async function createDaniFreeClient(input: DriverCreateInput<AcpConfig>, base: AcpSupport,
  loadSelectable: (environment: Record<string, string | undefined>, cli: string) => Promise<Pick<ModelCatalog, "options">>): Promise<ProviderInstance> {
  const catalog = new DaniFreeCatalog("opencode", input.instanceId, { scheduleRefresh: false });
  const root = join(DATA_DIR, "providers", "dani-free", "clients", `instance-${encodeURIComponent(input.instanceId)}`);
  const config = { ...input.config };
  const selectable: ModelCatalog = { default: "", options: [] };
  let clientError: string | undefined;
  let refreshPending: Promise<void> | undefined;
  const lifetime = new AbortController();
  const pendingHelpers = new Set<Promise<string>>();
  const envFor = () => {
    const env = { ...process.env, ...input.environment, PATH: augmentedPath() };
    isolateDaniFreeClientEnvironment(env, root, catalog.models);
    applyStandaloneSpawnEnv(OPENCODE_STANDALONE, env, config.cli);
    return env;
  };
  const refreshSelectable = async () => {
    if (lifetime.signal.aborted) return;
    try {
      const live = await loadSelectable(envFor(), config.cli);
      if (lifetime.signal.aborted) return;
      selectable.options = catalog.models.options.filter((model) => live.options.some((option) => option.id === model.id));
      selectable.default = selectable.options[0]?.id ?? "";
      clientError = selectable.options.length ? undefined : "Additional free models are not available in the prepared client yet. Retry setup or refresh.";
    } catch {
      selectable.options = [];
      selectable.default = "";
      clientError = "Additional free models need the Dani client to be prepared. Retry setup.";
    }
  };
  const refresh = () => {
    if (refreshPending) return refreshPending;
    refreshPending = (async () => {
      await catalog.refresh();
      await refreshSelectable();
    })().finally(() => { refreshPending = undefined; });
    return refreshPending;
  };
  const startup = catalog.startup.then(refreshSelectable);
  const timer = setInterval(() => { void refresh().catch(() => undefined); }, DANI_FREE_REFRESH_MS);
  timer.unref?.();
  const statusLog = base.statusLog;
  const support: AcpSupport = {
    ...base, displayName: "Dani", models: selectable, resolveModels: undefined,
    fallbackModel: undefined, resolveTurnModel: (model) => model,
    credentialEnv: [], images: true,
    describeAccountError: (code) => describeFreeModelError(code === "quota_or_region_restriction"),
    statusLog: statusLog ? {
      ...statusLog,
      parse(line, sessionId) {
        const signal = statusLog.parse(line, sessionId);
        return signal?.kind === "provider-error"
          ? { ...signal, message: describeFreeModelError(/usage limit|quota|rate limit/iu.test(signal.message)) }
          : signal;
      },
    } : undefined,
    transformEnv(env) {
      isolateDaniFreeClientEnvironment(env, root, catalog.models);
      applyStandaloneSpawnEnv(OPENCODE_STANDALONE, env, config.cli);
    },
    applyTurnEnv(env, context) {
      isolateDaniFreeClientEnvironment(env, root, catalog.models, context.model ?? selectable.default);
      applyStandaloneSpawnEnv(OPENCODE_STANDALONE, env, config.cli);
      base.applyTurnEnv?.(env, context);
    },
    isAuthenticated: async () => daniFreeActivated() && !catalog.stale && selectable.options.length > 0,
    oneShotFolder: async () => {
      const folder = join(root, "helpers");
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      return folder;
    },
  };
  const runtime = await createAcpDriver(support).create({ ...input, config, environment: {} });
  const requireModel = async (named?: string) => {
    lifetime.signal.throwIfAborted();
    if (!daniFreeActivated()) throw new Error("Set up Dani before using free model services.");
    await startup;
    lifetime.signal.throwIfAborted();
    if (catalog.stale) await refresh();
    lifetime.signal.throwIfAborted();
    const model = named ?? selectable.default;
    const metadata = await catalog.requireModel(model);
    lifetime.signal.throwIfAborted();
    if (!selectable.options.some((option) => option.id === model)) throw new Error("The selected free model is not available in the prepared Dani client. Refresh or retry setup.");
    return metadata;
  };
  const helper = (prompt: string, options: TextGenerationOptions = {}) => {
    const providerFailure = new AbortController();
    const signal = AbortSignal.any(options.signal
      ? [lifetime.signal, options.signal, providerFailure.signal]
      : [lifetime.signal, providerFailure.signal]);
    const pending = (async () => {
      signal.throwIfAborted();
      const model = await requireModel(options.model);
      signal.throwIfAborted();
      const env = envFor();
      isolateDaniFreeClientEnvironment(env, root, catalog.models, model.id);
      applyStandaloneSpawnEnv(OPENCODE_STANDALONE, env, config.cli);
      const helpers = join(root, "helpers");
      mkdirSync(helpers, { recursive: true, mode: 0o700 });
      const cwd = mkdtempSync(join(helpers, "text-"));
      let statusTimer: NodeJS.Timeout | undefined;
      let providerError: Error | undefined;
      try {
        const result = await runAcpOneShot({
          displayName: "Dani", spawn: spawnCli, kill: killCliTree, command: config.cli, argv: ["acp"],
          env, cwd, prompt, defaultModel: model.id, pickAuthMethod: () => null, authRequired: false,
          loginNote: "This free model is not available without payment credentials.",
          options: { ...options, signal, ...(options.onUsage ? { onUsage: (usage: TextGenerationUsage) => options.onUsage!({ ...usage, model: model.id }) } : {}) },
          async configure({ request, sessionId, session }) {
            signal.throwIfAborted();
            const logPath = statusLog?.path(env, sessionId);
            if (statusLog && logPath) {
              const tail = new LogTail(logPath);
              tail.read();
              statusTimer = setInterval(() => {
                if (signal.aborted) return;
                for (const line of tail.read()) {
                  const logged = statusLog.parse(line, sessionId);
                  if (logged?.kind !== "provider-error") continue;
                  providerError = new Error(describeFreeModelError(/usage limit|quota|rate limit/iu.test(logged.message)));
                  providerFailure.abort(providerError);
                  return;
                }
              }, 250);
              statusTimer.unref?.();
            }
            if (!offeredModels(session, "model").includes(model.id)) throw new Error("The selected free model is not selectable in the prepared Dani client.");
            if (acpModelOption(session, "model")?.currentValue === model.id) return;
            const selected = await request("session/set_config_option", { sessionId, configId: "model", value: model.id });
            signal.throwIfAborted();
            if (acpModelOption(selected, "model")?.currentValue !== model.id) throw new Error("The Dani client did not confirm the selected free model.");
          },
        });
        signal.throwIfAborted();
        return result;
      } catch (error) {
        throw providerError ?? error;
      } finally {
        clearInterval(statusTimer);
        rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    })();
    pendingHelpers.add(pending);
    pending.then(() => pendingHelpers.delete(pending), () => pendingHelpers.delete(pending));
    return pending;
  };
  return {
    ...runtime,
    startupModelRefresh: startup,
    get models() {
      const models = catalog.models;
      return { default: selectable.default || models.default, options: models.options.map((model) => {
        const available = daniFreeActivated() && !catalog.stale && selectable.options.some((option) => option.id === model.id);
        return { ...model, availability: available ? "available" as const : "preparing" as const,
          ...(!available ? { unavailableReason: !daniFreeActivated() ? "Set up Dani before using this model." : clientError ?? "This free model is being prepared." } : {}),
        };
      }) };
    },
    refreshModels: refresh,
    async installRuntime() {
      activateDaniFree();
      const installed = await installStandaloneEngine(OPENCODE_STANDALONE);
      config.cli = installed.executablePath;
      await refresh();
    },
    async snapshot() {
      if (!daniFreeActivated()) return { state: "unavailable", reason: "Set up Dani to prepare additional free models." };
      await startup;
      if (catalog.stale || !selectable.options.length) return { state: "unavailable", reason: clientError ?? "No current additional free models are available. Refresh and retry." };
      return runtime.snapshot();
    },
    adapter: {
      ...runtime.adapter,
      async sendTurn(turn) {
        const model = await requireModel(turn.model);
        lifetime.signal.throwIfAborted();
        return runtime.adapter.sendTurn({ ...turn, model: model.id,
          ...(!model.imageInput && turn.images?.length ? { images: undefined, text: `${turn.text}\n\n[The attached images are not visible to this text-only model.]` } : {}),
          ...(model.tools === false ? { integrations: undefined } : {}),
        });
      },
    },
    generateText: helper,
    generateMemoryText: helper,
    async dispose() {
      lifetime.abort(new Error("Dani free client is closed"));
      clearInterval(timer);
      await catalog.dispose();
      await startup.catch(() => undefined);
      await refreshPending?.catch(() => undefined);
      await Promise.all([...pendingHelpers].map((pending) => pending.catch(() => undefined)));
      await runtime.dispose();
    },
  };
}
