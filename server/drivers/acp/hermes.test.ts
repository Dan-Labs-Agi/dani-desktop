import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTempDir } from "../../testing/cleanup.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { resetPathCacheForTests } from "../../env-path.ts";
import { recordEvents } from "../../testing/events.ts";
import {
  HermesAgentDriver,
  HERMES_ACP_MODELS_TIMEOUT_ENV,
  HERMES_CONFIG_MODEL_ID,
  HERMES_OPENMAUS_SCREENSHOT_COMPAT,
  HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL,
  bindHermesScreenshotCompat,
  fetchHermesNativeModels,
  hermesAcpModelId,
  hermesConfiguredModel,
  hermesBrowserOnlyScope,
} from "./hermes.ts";


describe("Hermes browser-only admission", () => {
  it("admits only explicit browser MCP grants and preserves exact broker selectors", () => {
    expect(hermesBrowserOnlyScope({ allow: ["mcp:browser:*"] })).toBe(true);
    expect(hermesBrowserOnlyScope({ allow: ["mcp:browser:snapshot"], deny: ["mcp:browser:click"] })).toBe(true);
    for (const scope of [undefined, {}, { allow: [] }, { allow: ["native:*", "mcp:browser:*"] },
      { allow: ["mcp:mail:*"] }, { allow: ["mcp:browser:*", "native:terminal"] }]) {
      expect(hermesBrowserOnlyScope(scope)).toBe(false);
    }
  });
});
describe("Hermes Dani screenshot compatibility binding", () => {
  it("binds the exact leaf model for an injected local picker model", () => {
    const env = {
      [HERMES_OPENMAUS_SCREENSHOT_COMPAT]: undefined,
      [HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL]: undefined,
    };

    bindHermesScreenshotCompat(env, "omlx::gemma-4-31b-it-bf16");

    expect(env[HERMES_OPENMAUS_SCREENSHOT_COMPAT]).toBe("1");
    expect(env[HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL]).toBe("gemma-4-31b-it-bf16");
  });

  it.each([undefined, "", "anthropic/claude-opus-4.6", "unknown::model"])(
    "clears inherited compatibility for an unbound model %s",
    (model) => {
      const env = {
        [HERMES_OPENMAUS_SCREENSHOT_COMPAT]: "1",
        [HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL]: "stale/model",
      };

      bindHermesScreenshotCompat(env, model);

      expect(env[HERMES_OPENMAUS_SCREENSHOT_COMPAT]).toBeUndefined();
      expect(env[HERMES_OPENMAUS_SCREENSHOT_COMPAT_MODEL]).toBeUndefined();
    },
  );
});

describe("hermesConfiguredModel", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await removeTempDir(dir);
  });
  const home = (config: string) => {
    const root = mkdtempSync(join(tmpdir(), "omb-hermes-config-"));
    dirs.push(root);
    writeFileSync(join(root, "config.yaml"), config);
    return { HERMES_HOME: root };
  };

  it.each([
    "model: gpt-5.6-sol\nprovider: openai-codex\n",
    "model:\n  default: gpt-5.6-sol\n  provider: openai-codex\n",
    "model:\n  provider: auto\n  default:\n    provider: openai-codex\n    model: gpt-5.6-sol\n",
    "provider: openai-codex\nmodel:\n  name: gpt-5.6-sol\n",
  ])("keeps the configured route source internal and presents its actual model/provider: %s", (config) => {
    expect(hermesConfiguredModel(home(config))).toEqual({
      id: "openai-codex:gpt-5.6-sol", label: "gpt-5.6-sol", provider: "Codex", custom: true,
    });
  });

  it("does not invent a model when a key exists without a configured route", () => {
    const env = home("providers: {}\n");
    writeFileSync(join(env.HERMES_HOME, ".env"), "OPENROUTER_API_KEY=fixture-only\n");
    expect(hermesConfiguredModel(env)).toBeNull();
  });

  it.each(["custom", "ollama", "vllm", "llamacpp", "lmstudio"])("leaves the local %s catalog with local injection", (provider) => {
    expect(hermesConfiguredModel(home(`model:\n  default: local-model\n  provider: ${provider}\n`))).toBeNull();
  });

  it("preserves a named custom endpoint without treating its configuration as authorization", () => {
    const env = home("model:\n  default: restricted-model\n  provider: custom:opencode\nproviders:\n  opencode:\n    base_url: http://127.0.0.1:4187/v1\n");
    expect(hermesConfiguredModel(env)).toEqual({ id: "custom:opencode:restricted-model", label: "restricted-model", provider: "OpenCode", custom: true });
  });
});

describe("hermesAcpModelId", () => {
  it("forwards Hermes' own provider-scoped ids untouched", () => {
    expect(hermesAcpModelId("openrouter:qwen/qwen3.8-max")).toBe("openrouter:qwen/qwen3.8-max");
    expect(hermesAcpModelId("openrouter:deepseek/deepseek-v4-flash")).toBe(
      "openrouter:deepseek/deepseek-v4-flash",
    );
  });

  it("still maps local inject ids to Hermes' custom:<host>:<model> form", () => {
    expect(hermesAcpModelId("ollama::llama3")).toBe("custom:ollama:llama3");
  });

  it("keeps the internal follow-profile source out of the native route parser", () => {
    expect(hermesAcpModelId(HERMES_CONFIG_MODEL_ID)).toBeNull();
  });

  it("returns null for a bare word that names no provider", () => {
    expect(hermesAcpModelId("gpt-5")).toBeNull();
});
});

describe("Hermes model routing", () => {
  it.each([undefined, "", "claude-sonnet-5"])("refuses the unroutable model %j instead of running the model from config.yaml", async (model) => {
    const home = mkdtempSync(join(tmpdir(), "hermes-model-routing-"));
    let instance: ProviderInstance | undefined;
    vi.stubEnv("OMB_TEST_SEALED_PATH", "1");
    try {
      instance = await HermesAgentDriver.create({
        instanceId: "hermes-model-routing", displayName: "Hermes", enabled: true,
        environment: { HERMES_HOME: home },
        config: { cli: fileURLToPath(new URL("../../testing/fake-acp-cli.ts", import.meta.url)), fullAuto: false },
      });
      await expect(instance.adapter.sendTurn({
        threadId: "legacy-model", text: "Do not use a different model.", model,
      })).rejects.toThrow(/choose.*provider-qualified model/i);
    } finally {
      await instance?.dispose();
      vi.unstubAllEnvs();
      await removeTempDir(home);
    }
  });
});

describe("configured native default execution", () => {
  it.skipIf(process.platform === "win32").each(["managed", "unsupported"] as const)("keeps configured native execution inside a qualified installation (%s)", async (layout) => {
    const root = mkdtempSync(join(tmpdir(), "omb-hermes-default-switch-"));
    const bin = layout === "managed" ? join(root, "bin") : root;
    mkdirSync(bin, { recursive: true });
    const profile = join(root, ".hermes", "profiles", "dani-local");
    mkdirSync(profile, { recursive: true });
    let instance: ProviderInstance | undefined;
    const cli = join(bin, "hermes");
    const trace = join(root, "rpc.jsonl");
    const nativeProviders = [
      { id: "openrouter", label: "OpenRouter", models: ["old-model"], authenticatedModels: ["old-model"], toolModels: ["old-model"] },
      { id: "openai-codex", label: "Codex", models: ["gpt-5.6-sol", "gpt-5.6-terra"], authenticatedModels: ["gpt-5.6-sol", "gpt-5.6-terra"], toolModels: ["gpt-5.6-sol", "gpt-5.6-terra"] },
    ];
    mkdirSync(join(root, ".pi", "agent"), { recursive: true });
    writeFileSync(join(root, ".pi", "agent", "models.json"), JSON.stringify({ providers: {
      configured: { name: "Configured Proxy", baseUrl: "http://127.0.0.1:18900/v1", apiKey: "synthetic-proxy-secret", models: [{ id: "proxy-only-model", tools: true }] },
    } }));
    writeFileSync(join(bin, "python3"), `#!/usr/bin/env node
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
if (args[0].endsWith("hermes-model-metadata.py")) {
  console.log(${JSON.stringify(JSON.stringify({ providers: nativeProviders }))}); process.exit(0);
}
if (args.includes("--runtime-info") || args.includes("--qualify-route")) {
  const route = args.at(-1);
  const separator = route.startsWith("custom:") ? route.indexOf(":", 7) : route.indexOf(":");
  const configuredProvider = route.slice(0, separator), model = route.slice(separator + 1);
  const resolvedProvider = configuredProvider.startsWith("custom:") ? "custom" : configuredProvider;
  const codex = resolvedProvider === "openai-codex";
  const runtime = { version: "0.21.3", configuredProvider, resolvedProvider, model,
    endpoint: codex ? "https://chatgpt.com/backend-api/codex" : resolvedProvider === "custom" ? "http://127.0.0.1:18900/v1" : "https://openrouter.ai/api/v1",
    apiMode: codex ? "codex_responses" : "chat_completions", credentialFingerprint: "a".repeat(64), credentialHeaderNames: [] };
  const fields = ["version", "configuredProvider", "resolvedProvider", "model", "endpoint", "apiMode"];
  console.log(JSON.stringify(args.includes("--qualify-route") ? { schemaVersion: 1, qualified: true, toolCallCount: 1,
    resultConsumed: true, credentialFingerprint: runtime.credentialFingerprint, fingerprint: createHash("sha256").update(JSON.stringify(fields.map(key => runtime[key]))).digest("hex") } : runtime));
  process.exit(0);
}
const acpEntrypoint = ${JSON.stringify(pathToFileURL(cli).href)};
// Node 24+ evaluates static ESM imports before metadata-only argument handling.
await import(acpEntrypoint);
`, { mode: 0o755 });
    writeFileSync(cli, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
if (process.argv.includes("--version")) { console.log("0.21.3"); process.exit(0); }
let model = "openrouter:old-model";
for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (!msg.method) continue;
  if (msg.method === "session/set_model") model = msg.params.modelId;
  appendFileSync(process.env.CATALOG_TRACE, JSON.stringify({ method: msg.method, model, pid: process.pid, identity: JSON.parse(process.env.DANI_HERMES_QUALIFIED_IDENTITY),
    scopedProxyKey: Object.entries(process.env).some(([name,value]) => name.startsWith("DANI_HERMES_API_KEY_") && value === "synthetic-proxy-secret"),
    foreignKey: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
  }) + "\\n");
  if (msg.method === "session/prompt") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "catalog-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The requested native route was selected." } } } }) + "\\n");
  }
  const result = msg.method === "initialize" ? { protocolVersion: 1, agentCapabilities: { loadSession: true } }
    : msg.method === "session/new" ? { sessionId: "catalog-session", models: { currentModelId: model, availableModels: [] } }
    : msg.method === "session/prompt" ? { stopReason: "end_turn" } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
}
`, { mode: 0o755 });
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => Response.json({ data: String(url) === "http://127.0.0.1:18900/v1/models" ? [{ id: "proxy-only-model", tool_call: true }] : [] })));
    vi.stubEnv("OMB_TEST_SEALED_PATH", "");
    try {
      writeFileSync(join(profile, "config.yaml"), "model:\n  default: old-model\n  provider: openrouter\nproviders: { existing: { base_url: http://127.0.0.1:18902/v1 } }\n");
      instance = await HermesAgentDriver.create({
        instanceId: `root-default-switch-${crypto.randomUUID()}`, enabled: true, displayName: "Native fixture",
        environment: { HERMES_HOME: profile, HOME: root, USERPROFILE: root, CATALOG_TRACE: trace, OPENAI_API_KEY: "foreign-openai-key", ANTHROPIC_API_KEY: "foreign-anthropic-key" },
        config: { cli, fullAuto: false },
      });
      const recorder = recordEvents(instance.adapter);
      if (layout === "unsupported") {
        await expect(instance.snapshot()).resolves.toMatchObject({ state: "unavailable" });
        await expect(instance.adapter.sendTurn({ threadId: "unsupported-installation", text: "Do not bypass native policy.", model: HERMES_CONFIG_MODEL_ID })).rejects.toThrow();
        recorder.stop();
        return;
      }
      const first = await instance.adapter.sendTurn({ threadId: "same-native-session", text: "First native route.", model: HERMES_CONFIG_MODEL_ID });
      const firstCompleted = await recorder.until(event => event.type === "turn.completed" && event.turnId === first.turnId);
      expect(firstCompleted, JSON.stringify(recorder.events)).toMatchObject({ ok: true });
      writeFileSync(join(profile, "config.yaml"), "model:\n  default: gpt-5.6-sol\n  provider: openai-codex\nproviders: { existing: { base_url: http://127.0.0.1:18902/v1 } }\n");
      await instance.refreshModels?.();
      const second = await instance.adapter.sendTurn({ threadId: "same-native-session", text: "Keep the configured provider.", model: HERMES_CONFIG_MODEL_ID });
      expect(await recorder.until(event => event.type === "turn.completed" && event.turnId === second.turnId)).toMatchObject({ ok: true });
      await expect(instance.adapter.sendTurn({ threadId: "same-native-session", text: "Must not be sent.", model: "openai-codex:gpt-6-sol" })).rejects.toThrow(/not been confirmed/i);
      const explicit = await instance.adapter.sendTurn({ threadId: "same-native-session", text: "Keep my explicit native pin.", model: "openai-codex:gpt-5.6-sol" });
      expect(await recorder.until(event => event.type === "turn.completed" && event.turnId === explicit.turnId)).toMatchObject({ ok: true });
      expect(instance.models.options.filter(option => option.id === "openai-codex:gpt-5.6-sol")).toHaveLength(1);
      expect(instance.models.options.some(option => option.id === HERMES_CONFIG_MODEL_ID)).toBe(false);
      const calls: Array<{ method: string; model: string; pid: number; identity: { configuredProvider: string; model: string } }> = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(calls.filter(call => call.method === "session/new")).toHaveLength(2);
      const prompts = calls.filter(call => call.method === "session/prompt");
      expect(prompts[0]!.pid).not.toBe(prompts[1]!.pid);
      expect(prompts[1]!.pid).toBe(prompts[2]!.pid);
      expect(prompts.map(call => `${call.identity.configuredProvider}:${call.identity.model}`)).toEqual([
        "openrouter:old-model", "openai-codex:gpt-5.6-sol", "openai-codex:gpt-5.6-sol",
      ]);
      expect(calls.filter(call => call.method === "session/set_model").map(call => call.model)).toEqual(["openrouter:old-model", "openai-codex:gpt-5.6-sol", "openai-codex:gpt-5.6-sol"]);
      expect(calls.filter(call => call.method === "session/prompt").map(call => call.model)).toEqual(["openrouter:old-model", "openai-codex:gpt-5.6-sol", "openai-codex:gpt-5.6-sol"]);
      const proxy = instance.models.options.find(option => option.provider === "Configured Proxy");
      expect(proxy).toMatchObject({ availability: "available", tools: true });
      if (!proxy) throw new Error("Configured proxy fixture was not cataloged.");
      const proxied = await instance.adapter.sendTurn({ threadId: "proxy-native-session", text: "Use the selected proxy route.", model: proxy.id });
      expect(await recorder.until(event => event.type === "turn.completed" && event.turnId === proxied.turnId)).toMatchObject({ ok: true });
      const proxyCalls: Array<{ method: string; model: string; scopedProxyKey: boolean; foreignKey: boolean }> = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(proxyCalls.find(call => call.method === "session/prompt" && call.model === proxy.id)).toMatchObject({ scopedProxyKey: true, foreignKey: false });
      expect(instance.driverKind).toBe("hermesAgent");
      expect(readFileSync(join(profile, "config.yaml"), "utf8")).toContain("api_mode: chat_completions");
      expect(readFileSync(join(profile, "config.yaml"), "utf8")).toContain("existing:");
      expect(readFileSync(join(profile, "config.yaml"), "utf8")).not.toContain("synthetic-proxy-secret");
      recorder.stop();
      const instanceId = instance.instanceId;
      await instance.dispose();
      instance = await HermesAgentDriver.create({
        instanceId, enabled: true, displayName: "Native fixture",
        environment: { HERMES_HOME: profile, HOME: root, USERPROFILE: root, CATALOG_TRACE: trace },
        config: { cli, fullAuto: false },
      });
      expect(instance.models.default).toBe("openai-codex:gpt-5.6-sol");
      expect(instance.models.options.find(option => option.id === instance?.models.default)).toMatchObject({ availability: "available", provider: "Codex" });
      expect(instance.models.options.find(option => option.id === "openai-codex:gpt-6-sol")).toMatchObject({ availability: "unavailable" });
    } finally {
      await instance?.dispose();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await removeTempDir(root);
    }
  });
});

describe("native read-only model metadata discovery", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await removeTempDir(dir);
  });
  it.skipIf(process.platform === "win32").each(["absolute", "PATH", "symlink"] as const)("reads provider metadata from the selected installation without launching ACP (%s)", async (selection) => {
    const root = mkdtempSync(join(tmpdir(), "omb-hermes-metadata-"));
    dirs.push(root);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const cli = join(bin, "hermes");
    writeFileSync(cli, "#!/usr/bin/env node\nprocess.exit(17);\n", { mode: 0o755 });
    writeFileSync(join(bin, "python3"), '#!/bin/sh\nprintf \'%s\\n\' \'{"providers":[{"id":"openai-codex","label":"Codex","models":["gpt-5.6-sol"],"authenticatedModels":["gpt-5.6-sol"]}]}\'\n', { mode: 0o755 });
    const linked = join(root, "linked hermes");
    if (selection === "symlink") symlinkSync(cli, linked);
    const metadata = await fetchHermesNativeModels(selection === "PATH" ? "hermes" : selection === "symlink" ? linked : cli, {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, HERMES_HOME: root, [HERMES_ACP_MODELS_TIMEOUT_ENV]: "2000",
    });
    expect(metadata.providers).toEqual([{ id: "openai-codex", label: "Codex", models: ["gpt-5.6-sol"], authenticatedModels: ["gpt-5.6-sol"] }]);
  });

  it("does not fall back to ACP construction when the native interpreter is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "omb-hermes-missing-python-"));
    dirs.push(root);
    const cli = join(root, "hermes");
    writeFileSync(cli, "#!/usr/bin/env node\nprocess.exit(17);\n", { mode: 0o755 });
    await expect(fetchHermesNativeModels(cli, { HERMES_HOME: root })).resolves.toEqual({ providers: [] });
  });
});

describe("per-model native tool qualification", () => {
  it.skipIf(process.platform === "win32").each(["absolute", "PATH"] as const)("does not send a task to an advertised model that fails native tool-result qualification (%s)", async (selection) => {
    const root = mkdtempSync(join(tmpdir(), "omb-hermes-qualified-route-"));
    const bin = join(root, "bin");
    const profile = join(root, ".hermes", "profiles", "dani-local");
    mkdirSync(bin); mkdirSync(profile, { recursive: true });
    const trace = join(root, "prompts.jsonl");
    writeFileSync(join(profile, "config.yaml"), "model:\n  default: verified\n  provider: openrouter\n");
    writeFileSync(join(bin, "hermes"), "#!/usr/bin/env node\nconsole.log('0.21.3');\n", { mode: 0o755 });
    writeFileSync(join(bin, "python3"), `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
const argv=process.argv.slice(2);
if(argv.includes("--version")){ console.log("0.21.3"); process.exit(0); }
if(argv[0].endsWith("hermes-model-metadata.py")){
  console.log(JSON.stringify({providers:[{id:"openrouter",label:"OpenRouter",models:["verified","unverified"],authenticatedModels:["verified","unverified"],toolModels:["verified","unverified"]}]})); process.exit(0);
}
if(argv.includes("--runtime-info")||argv.includes("--qualify-route")){
  const route=argv.at(-1); const model=route.startsWith("openrouter:")?route.slice(11):"verified";
  const runtime={version:"0.21.3",configuredProvider:"openrouter",resolvedProvider:"openrouter",model,endpoint:"https://openrouter.ai/api/v1",apiMode:"chat_completions",credentialsResolved:true,credentialFingerprint:"a".repeat(64),credentialHeaderNames:[]};
  const fields=["version","configuredProvider","resolvedProvider","model","endpoint","apiMode"];
  console.log(JSON.stringify(argv.includes("--qualify-route")?{schemaVersion:1,qualified:model==="verified",toolCallCount:model==="verified"?1:0,resultConsumed:model==="verified",runtime,credentialFingerprint:runtime.credentialFingerprint,fingerprint:createHash("sha256").update(JSON.stringify(fields.map(k=>runtime[k]))).digest("hex")}:runtime)); process.exit(0);
}
let model="openrouter:verified";
for await(const line of createInterface({input:process.stdin})){
  const msg=JSON.parse(line); if(!msg.method)continue;
  if(msg.method==="session/set_model")model=msg.params.modelId;
  if(msg.method==="session/prompt"){
    appendFileSync(process.env.QUALIFICATION_TRACE,JSON.stringify({model})+"\\n");
    console.log(JSON.stringify({jsonrpc:"2.0",method:"session/update",params:{sessionId:"qualified-session",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"Verified native model completed its task."}}}}));
  }
  const result=msg.method==="initialize"?{protocolVersion:1,agentCapabilities:{loadSession:true}}:msg.method==="session/new"?{sessionId:"qualified-session",models:{currentModelId:model,availableModels:[]}}:msg.method==="session/prompt"?{stopReason:"end_turn"}:{};
  console.log(JSON.stringify({jsonrpc:"2.0",id:msg.id,result}));
}
`, { mode: 0o755 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    vi.stubEnv("OMB_TEST_SEALED_PATH", "");
    if (selection === "PATH") {
      vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
      resetPathCacheForTests();
    }
    let instance: ProviderInstance | undefined;
    try {
      instance = await HermesAgentDriver.create({ instanceId: `qualified-${crypto.randomUUID()}`, displayName: "Qualified fixture", enabled: true,
        environment: { HERMES_HOME: profile, HOME: root, USERPROFILE: root, QUALIFICATION_TRACE: trace },
        config: { cli: selection === "PATH" ? "hermes" : join(bin, "hermes"), fullAuto: false } });
      const events = recordEvents(instance.adapter);
      const first = await instance.adapter.sendTurn({ threadId: "qualification-thread", text: "Run the verified route.", model: "openrouter:verified" });
      expect(await events.until(event => event.type === "turn.completed" && event.turnId === first.turnId)).toMatchObject({ ok: true });
      const second = await instance.adapter.sendTurn({ threadId: "qualification-thread", text: "Must never reach the unqualified model.", model: "openrouter:unverified" });
      expect(await events.until(event => event.type === "turn.completed" && event.turnId === second.turnId)).toMatchObject({ ok: false });
      expect(readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual([{ model: "openrouter:verified" }]);
      events.stop();
    } finally {
      await instance?.dispose(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetPathCacheForTests(); await removeTempDir(root);
    }
  });
});

it.skipIf(process.platform === "win32")("does not advertise readiness from a CLI banner when its interpreter has another native version", async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-hermes-runtime-version-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "hermes"), "#!/usr/bin/env node\nconsole.log('0.21.3');\n", { mode: 0o755 });
  writeFileSync(join(bin, "python3"), "#!/usr/bin/env node\nconsole.log('0.15.2');\n", { mode: 0o755 });
  vi.stubEnv("OMB_TEST_SEALED_PATH", "1");
  let instance: ProviderInstance | undefined;
  try {
    instance = await HermesAgentDriver.create({
      instanceId: `runtime-version-${crypto.randomUUID()}`, displayName: "Runtime version fixture", enabled: true,
      environment: { HOME: root, USERPROFILE: root, HERMES_HOME: root },
      config: { cli: join(bin, "hermes"), fullAuto: false },
    });
    await expect(instance.snapshot()).resolves.toMatchObject({ state: "unavailable", reason: expect.stringContaining("Settings → Model providers") });
  } finally {
    await instance?.dispose();
    vi.unstubAllEnvs();
    await removeTempDir(root);
  }
});
