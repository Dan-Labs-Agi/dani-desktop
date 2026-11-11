import type { ProviderDriver } from "../contracts.ts";
import { activateDaniFree, daniFreeActivated, DaniFreeCatalog } from "./dani-free-catalog.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

export type DaniFreeConfig = Record<string, never>;

export const DaniFreeDriver: ProviderDriver<DaniFreeConfig> = {
  driverKind: "daniFree",
  metadata: { displayName: "Dani", supportsMultipleInstances: true, access: "subscription" },
  models: { default: "", options: [] },
  install: { managed: { label: "Set up Dani", downloadBytes: 0 }, docsUrl: "https://kilo.ai/docs/gateway/models-and-providers" },
  decodeConfig(raw) {
    if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 0)) {
      throw new Error("Dani free models do not accept provider credentials or endpoint overrides");
    }
    return {};
  },
  defaultConfig: () => ({}),
  async create(input) {
    const catalog = new DaniFreeCatalog("kilo", input.instanceId);
    const lifetime = new AbortController();
    const pendingHelpers = new Set<Promise<string>>();
    const requireModel = async (model: string) => {
      lifetime.signal.throwIfAborted();
      if (!daniFreeActivated()) throw new Error("Set up Dani before sending messages to free model services.");
      await catalog.requireModel(model);
      lifetime.signal.throwIfAborted();
      return model;
    };
    const runtime = createOpenAIChatRuntime({
      input: { ...input, environment: {} }, driverKind: "daniFree", apiKey: "", anonymous: true,
      apiUrl: "https://ai-gateway.kilo.ai/api/v1", models: () => catalog.models,
      refreshModels: () => catalog.refresh(), servedModel: requireModel,
      modelTools: (id) => catalog.models.options.find((model) => model.id === id)?.tools === true,
      imageInput: (id) => catalog.models.options.find((model) => model.id === id)?.imageInput === true,
      computerUse: true, reasoning: true, includeUsageInCompleted: true,
      requestBody: (model, messages, stream) => ({ model, messages, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }),
      httpErrorLabel: "Dani free model", missingKeyError: "Set up Dani first", unavailableReason: "Set up Dani first", timeoutMs: 180_000,
      nativeLog: {
        source: "dani.free.chat.completions",
        outgoing: (_turn, messages, model) => ({ model, messageCount: messages.length }),
        incoming: ({ text, usage }) => ({ textLength: text.length, usage }),
      },
    });
    return {
      ...runtime,
      startupModelRefresh: catalog.startup,
      get models() {
        const models = catalog.models;
        return daniFreeActivated() ? models : { ...models, options: models.options.map((model) => ({ ...model,
          availability: "preparing" as const, unavailableReason: "Set up Dani before using this model.",
        })) };
      },
      async installRuntime() {
        activateDaniFree();
        await catalog.refresh();
      },
      async snapshot() {
        if (!daniFreeActivated()) return { state: "unavailable", reason: "Set up Dani to use free models. Some services retain prompts or use them for training." };
        await catalog.startup;
        if (catalog.stale || !catalog.models.options.length) return { state: "unavailable", reason: "No current free models are available. Refresh and retry." };
        return { state: "available", authenticated: true, version: null };
      },
      adapter: {
        ...runtime.adapter,
        async sendTurn(turn) {
          lifetime.signal.throwIfAborted();
          await catalog.startup;
          const model = turn.model ?? catalog.models.default;
          await requireModel(model);
          return runtime.adapter.sendTurn({ ...turn, model });
        },
      },
      generateText(prompt, options = {}) {
        const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
        const pending = (async () => {
          signal.throwIfAborted();
          await catalog.startup;
          signal.throwIfAborted();
          const model = options.model ?? catalog.models.default;
          await requireModel(model);
          signal.throwIfAborted();
          const result = await runtime.generateText!(prompt, { ...options, model, signal });
          signal.throwIfAborted();
          return result;
        })();
        pendingHelpers.add(pending);
        pending.then(() => pendingHelpers.delete(pending), () => pendingHelpers.delete(pending));
        return pending;
      },
      async dispose() {
        lifetime.abort(new Error("Dani free model instance is closed"));
        await catalog.dispose();
        await Promise.all([...pendingHelpers].map((pending) => pending.catch(() => undefined)));
        await runtime.dispose();
      },
    };
  },
};
