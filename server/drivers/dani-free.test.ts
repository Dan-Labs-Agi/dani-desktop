import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type * as ConfigModule from "../config.ts";
import type * as StandaloneModule from "../engine-standalone.ts";
import type { AcpOneShotInput } from "./acp/background-text.ts";
import type { RuntimeEvent } from "../contracts.ts";

vi.mock("../config.ts", async (importOriginal) => {
  const original = await importOriginal<typeof ConfigModule>();
  // Vitest hoists this factory before static imports initialize.
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { ...original, DATA_DIR: mkdtempSync(join(tmpdir(), "dani-free-driver-test-")) };
});
vi.mock("../engine-standalone.ts", async (importOriginal) => ({
  ...await importOriginal<typeof StandaloneModule>(),
  installStandaloneEngine: vi.fn(async () => ({ executablePath: "fixture-opencode", binDir: "/fixture", version: "1.19.4" })),
}));
vi.mock("./acp/background-text.ts", () => ({
  runAcpOneShot: vi.fn(async (input: AcpOneShotInput) => {
    const model = JSON.parse(input.env.OPENCODE_CONFIG_CONTENT!).model as string;
    const request = vi.fn(async (_method: string, params: unknown) => {
      if (!params || typeof params !== "object" || !("value" in params)) throw new Error("missing selected model");
      const value = params.value;
      return { configOptions: [{ id: "model", type: "select", currentValue: value, options: [{ value: model, name: model }] }] };
    });
    await input.configure?.({ request, sessionId: "helper", session: {
      configOptions: [{ id: "model", type: "select", currentValue: "opencode/other", options: [{ value: model, name: model }] }],
    } });
    expect(request).toHaveBeenCalledWith("session/set_config_option", { sessionId: "helper", configId: "model", value: model });
    return "client answer";
  }),
}));
vi.mock("./native.ts", () => ({ appendNative: vi.fn() }));

import { DATA_DIR } from "../config.ts";
import { dirname, join } from "node:path";
import { DaniFreeDriver } from "./dani-free.ts";
import { createOpenCodeDriver, openCodeLogPath } from "./acp/opencode-go.ts";
import { isolateDaniFreeClientEnvironment } from "./dani-free-client.ts";
import { runAcpOneShot } from "./acp/background-text.ts";
import { activateDaniFree, DaniFreeCatalog } from "./dani-free-catalog.ts";

const kiloRow = (id: string) => ({ id, name: `Name ${id}`, pricing: { prompt: "0", completion: "0" },
  architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: [] });
const clientRow = (id: string) => ({ id, name: `Name ${id}`, type: "chat", modalities: { input: ["text"], output: ["text"] },
  cost: { text: { input: { price: 0 }, output: { price: 0 } } }, capabilities: { tools: { supported: true } } });

afterEach(() => { vi.unstubAllGlobals(); rmSync(join(DATA_DIR, "providers", "dani-free"), { recursive: true, force: true }); });
afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));

describe("Dani native anonymous consumer", () => {
  it("discovers before consent, activates durably, preserves explicit helper choice and rejects paid selections without inference", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return url.endsWith("/models") ? Response.json({ data: [kiloRow("first"), kiloRow("selected")] })
        : Response.json({ choices: [{ message: { content: "exact answer" }, finish_reason: "stop" }] });
    }));
    const input = { instanceId: "native", displayName: "Dani", enabled: true, config: {}, environment: { KILO_API_KEY: "never-forward-this", OPENAI_API_KEY: "also-never" } };
    const instance = await DaniFreeDriver.create(input);
    await instance.startupModelRefresh;
    expect(instance.models.options.map((model) => model.id)).toEqual(["first", "selected"]);
    expect(instance.models.options.every((model) => model.availability === "preparing")).toBe(true);
    await expect(instance.snapshot()).resolves.toMatchObject({ state: "unavailable" });
    await expect(instance.generateText!("private prompt", { model: "selected" })).rejects.toThrow("Set up Dani");
    await expect(instance.adapter.sendTurn({ threadId: "pre-consent", text: "private prompt", model: "selected" })).rejects.toThrow("Set up Dani");
    expect(requests.every(({ url }) => url.endsWith("/models"))).toBe(true);
    await instance.installRuntime!();
    await expect(instance.snapshot()).resolves.toMatchObject({ state: "available", authenticated: true });
    await expect(instance.generateText!("hello", { model: "selected" })).resolves.toBe("exact answer");
    const inference = requests.filter(({ url }) => url.endsWith("/chat/completions"));
    expect(inference).toHaveLength(1);
    expect(JSON.parse(inference[0]!.init!.body as string).model).toBe("selected");
    expect(new Headers(inference[0]!.init!.headers).has("authorization")).toBe(false);
    expect(JSON.stringify(requests)).not.toContain("never-forward-this");
    await expect(instance.generateText!("hello", { model: "paid" })).rejects.toThrow("not currently eligible");
    expect(requests.filter(({ url }) => url.endsWith("/chat/completions"))).toHaveLength(1);
    const events: RuntimeEvent[] = [];
    instance.adapter.onEvent((event) => events.push(event));
    await instance.adapter.sendTurn({ threadId: "text-only", text: "hello", model: "selected",
      images: [{ path: "/nonexistent-private-attachment", mime: "image/png", bytes: 100 }],
      integrations: { custom: { neverMounted: { command: "/nonexistent-mcp", args: [], env: { OPENAI_API_KEY: "integration-secret" } } } },
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === "turn.completed")).toBe(true));
    const turnBody = JSON.parse(requests.filter(({ url }) => url.endsWith("/chat/completions")).at(-1)!.init!.body as string);
    expect(turnBody.model).toBe("selected");
    expect(turnBody.tools).toBeUndefined();
    expect(JSON.stringify(turnBody)).not.toContain("image_url");
    expect(JSON.stringify(turnBody)).not.toContain("integration-secret");
    await instance.dispose();
    const recreated = await DaniFreeDriver.create(input);
    await expect(recreated.snapshot()).resolves.toMatchObject({ state: "available", authenticated: true });
    await recreated.dispose();
  });

  it("aborts active native helpers and awaits request cleanup before disposal completes", async () => {
    activateDaniFree();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: [kiloRow("selected")] });
      signal = init?.signal ?? undefined;
      entered();
      await cleanup;
      signal?.throwIfAborted();
      return Response.json({ choices: [{ message: { content: "must not finish" }, finish_reason: "stop" }] });
    }));
    const instance = await DaniFreeDriver.create({ instanceId: "native-held", displayName: "Dani", enabled: true, config: {}, environment: {} });
    const result = instance.generateText!("held", { model: "selected" }).catch((error: unknown) => error);
    await started;
    let disposed = false;
    const disposing = instance.dispose().then(() => { disposed = true; });
    try {
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      expect(disposed).toBe(false);
    } finally {
      release();
      await disposing;
      await result;
    }
    expect(await result).toBeInstanceOf(Error);
  });

  it("blocks retained native helper and chat references after disposal", async () => {
    activateDaniFree();
    const fetch = vi.fn(async (url: string) => url.endsWith("/models")
      ? Response.json({ data: [kiloRow("selected")] })
      : Response.json({ choices: [{ message: { content: "must not infer" }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetch);
    const instance = await DaniFreeDriver.create({ instanceId: "native-closed", displayName: "Dani", enabled: true, config: {}, environment: {} });
    await instance.startupModelRefresh;
    const helper = instance.generateText!;
    const send = instance.adapter.sendTurn;
    await instance.dispose();
    await expect(helper("closed", { model: "selected" })).rejects.toThrow(/closed|abort|disposed/iu);
    await expect(send({ threadId: "closed", text: "closed", model: "selected" })).rejects.toThrow(/closed|abort|disposed/iu);
    expect(fetch.mock.calls.every(([url]) => url.endsWith("/models"))).toBe(true);
  });

  it.each(["helper", "chat"] as const)("never starts native %s inference after disposal crosses model validation", async (kind) => {
    activateDaniFree();
    const fetch = vi.fn(async (url: string) => url.endsWith("/models")
      ? Response.json({ data: [kiloRow("selected")] })
      : Response.json({ choices: [{ message: { content: "must not infer" }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetch);
    const instance = await DaniFreeDriver.create({ instanceId: "native-validation", displayName: "Dani", enabled: true, config: {}, environment: {} });
    await instance.startupModelRefresh;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = DaniFreeCatalog.prototype.requireModel;
    const requireModel = vi.spyOn(DaniFreeCatalog.prototype, "requireModel").mockImplementationOnce(async function (this: DaniFreeCatalog, id) {
      entered();
      await gate;
      return original.call(this, id);
    });
    const result = (kind === "helper"
      ? instance.generateText!("closed", { model: "selected" })
      : instance.adapter.sendTurn({ threadId: "closing-validation", text: "closed", model: "selected" })).catch((error: unknown) => error);
    await started;
    const disposing = instance.dispose();
    release();
    try {
      await disposing;
      expect(await result).toBeInstanceOf(Error);
      expect(fetch.mock.calls.every(([url]) => url.endsWith("/models"))).toBe(true);
    } finally {
      requireModel.mockRestore();
      await result;
    }
  });

  it("does not accept arbitrary endpoints or payment keys in managed driver config", () => {
    expect(DaniFreeDriver.decodeConfig({})).toEqual({});
    expect(() => DaniFreeDriver.decodeConfig({ url: "https://paid.invalid", apiKey: "secret" })).toThrow("do not accept");
  });
});

it("isolates all client credential and configuration roots and pins main plus helper to the selected free model", () => {
  const env = { PATH: "/usr/bin", HOME: "/real/home", OPENAI_API_KEY: "paid-key", AWS_SECRET_ACCESS_KEY: "aws-secret",
    OPENCODE_API_KEY: "paid-opencode", OPENCODE_CONFIG: "/workspace/config", OPENCODE_AUTH_CONTENT: "paid-auth", NODE_OPTIONS: "--require=evil", CUSTOM_BILLING_TOKEN: "billing",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/cert.pem", HTTPS_PROXY: "http://127.0.0.1:8080", NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  isolateDaniFreeClientEnvironment(env, join(DATA_DIR, "isolated"), { default: "opencode/first", options: [
    { id: "opencode/first", label: "First" }, { id: "opencode/selected", label: "Selected", tools: false },
  ] }, "opencode/selected");
  expect(env.PATH).toBe("/usr/bin");
  expect(env.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/cert.pem");
  expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:8080");
  expect(Object.hasOwn(env, "NODE_TLS_REJECT_UNAUTHORIZED")).toBe(false);
  expect(env.HOME).toBe(join(DATA_DIR, "isolated", "home"));
  expect(JSON.stringify(env)).not.toMatch(/paid-key|aws-secret|paid-opencode|paid-auth|billing|--require=evil|\/workspace\/config/u);
  expect(JSON.parse((env as Record<string, string>).OPENCODE_CONFIG_CONTENT!)).toMatchObject({
    model: "opencode/selected", small_model: "opencode/selected", enabled_providers: ["opencode"], tools: { "*": false },
  });
});

it("keeps every public free client row visible but unavailable when the genuine client cannot select it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [clientRow("selectable"), clientRow("second"), clientRow("not-in-client")] })));
  const load = vi.fn(async () => ({ default: "opencode/selectable", options: [
    { id: "opencode/selectable", label: "Upstream label" }, { id: "opencode/second", label: "Second" }, { id: "opencode/paid", label: "Paid" },
  ] }));
  const driver = createOpenCodeDriver(load);
  const instance = await driver.create({ instanceId: "client", displayName: "Dani", enabled: true, environment: { OPENAI_API_KEY: "never-client" }, config: driver.decodeConfig({ freeOnly: true }) });
  await instance.startupModelRefresh;
  expect(instance.models.options.map((model) => model.id)).toEqual(["opencode/selectable", "opencode/second", "opencode/not-in-client"]);
  expect(instance.models.options.every((model) => model.availability !== "available")).toBe(true);
  await expect(instance.generateText!("private prompt", { model: "opencode/selectable" })).rejects.toThrow("Set up Dani");
  expect(JSON.stringify(load.mock.calls)).not.toContain("never-client");
  await instance.installRuntime!();
  expect(instance.models.options).toMatchObject([
    { id: "opencode/selectable", label: "Name selectable", availability: "available" },
    { id: "opencode/second", availability: "available" },
    { id: "opencode/not-in-client", availability: "preparing" },
  ]);
  await expect(instance.generateText!("hello", { model: "opencode/paid" })).rejects.toThrow("not currently eligible");
  await expect(instance.generateText!("hello", { model: "opencode/second" })).resolves.toBe("client answer");
  expect(JSON.parse(vi.mocked(runAcpOneShot).mock.calls[0]![0].env.OPENCODE_CONFIG_CONTENT!)).toMatchObject({
    model: "opencode/second", small_model: "opencode/second",
  });
  await expect(instance.adapter.sendTurn({ threadId: "missing", text: "hello", model: "opencode/not-in-client" })).rejects.toThrow("not available");
  await instance.dispose();
});

it("does not claim additional models ready when client preparation cannot discover a genuine session", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [clientRow("free")] })));
  const driver = createOpenCodeDriver(async () => { throw new Error("client unavailable"); });
  const instance = await driver.create({ instanceId: "unavailable-client", displayName: "Dani", enabled: true,
    environment: {}, config: driver.decodeConfig({ freeOnly: true }),
  });
  await instance.startupModelRefresh;
  await instance.installRuntime!();
  expect(instance.models.options).toMatchObject([{ id: "opencode/free", availability: "preparing" }]);
  await expect(instance.snapshot()).resolves.toMatchObject({ state: "unavailable" });
  await expect(instance.generateText!("hello", { model: "opencode/free" })).rejects.toThrow("not available");
  await instance.dispose();
});

describe("Dani free client helper lifecycle", () => {
  const client = async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [clientRow("free")] })));
    activateDaniFree();
    const driver = createOpenCodeDriver(async () => ({ default: "opencode/free", options: [{ id: "opencode/free", label: "Free" }] }));
    const instance = await driver.create({ instanceId: "helper-lifecycle", displayName: "Dani", enabled: true,
      environment: {}, config: driver.decodeConfig({ freeOnly: true }),
    });
    await instance.startupModelRefresh;
    return instance;
  };

  it("aborts owned held helpers and awaits their cleanup before disposal completes", async () => {
    const instance = await client();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => { release = resolve; });
    let signal: AbortSignal | undefined;
    vi.mocked(runAcpOneShot).mockImplementationOnce(async (input) => {
      signal = input.options?.signal;
      entered();
      await cleanup;
      signal?.throwIfAborted();
      return "not aborted";
    });
    const result = instance.generateText!("held helper", { model: "opencode/free" }).catch((error: unknown) => error);
    await started;
    let disposed = false;
    const disposing = instance.dispose().then(() => { disposed = true; });
    try {
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      expect(disposed).toBe(false);
    } finally {
      release();
      await disposing;
      await result;
    }
    expect(await result).toBeInstanceOf(Error);
  });

  it("never launches a helper after disposal crosses its model-validation await", async () => {
    const instance = await client();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = DaniFreeCatalog.prototype.requireModel;
    const requireModel = vi.spyOn(DaniFreeCatalog.prototype, "requireModel").mockImplementationOnce(async function (this: DaniFreeCatalog, id) {
      entered();
      await gate;
      return original.call(this, id);
    });
    vi.mocked(runAcpOneShot).mockClear();
    const result = instance.generateText!("must never launch", { model: "opencode/free" }).catch((error: unknown) => error);
    await started;
    const disposing = instance.dispose();
    release();
    try {
      await disposing;
      expect(await result).toBeInstanceOf(Error);
      expect(runAcpOneShot).not.toHaveBeenCalled();
      await expect(instance.generateMemoryText!("after dispose", { model: "opencode/free" })).rejects.toThrow(/closed|abort|disposed/iu);
      expect(runAcpOneShot).not.toHaveBeenCalled();
    } finally {
      requireModel.mockRestore();
      await result;
    }
  });

  it("preserves caller abort for a running helper", async () => {
    const instance = await client();
    const caller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(runAcpOneShot).mockImplementationOnce(async (input) => {
      const signal = input.options?.signal;
      entered();
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      signal?.throwIfAborted();
      return "not aborted";
    });
    const result = instance.generateText!("cancel me", { model: "opencode/free", signal: caller.signal }).catch((error: unknown) => error);
    await started;
    caller.abort(new Error("caller cancelled helper"));
    expect(await result).toMatchObject({ message: "caller cancelled helper" });
    await instance.dispose();
  });

  it("propagates matching main-session provider log refusal instead of waiting for a silent ACP timeout", async () => {
    vi.useFakeTimers();
    const instance = await client();
    const caller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let logPath = "";
    vi.mocked(runAcpOneShot).mockImplementationOnce(async (input) => {
      const signal = input.options?.signal;
      await input.configure?.({ request: vi.fn(), sessionId: "ses_owned", session: {
        configOptions: [{ id: "model", type: "select", currentValue: "opencode/free", options: [{ value: "opencode/free", name: "Free" }] }],
      } });
      logPath = openCodeLogPath(input.env);
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, 'level=ERROR session.id=ses_other small=false error.error="AI_APICallError: Free usage limit reached."\n'
        + 'level=ERROR session.id=ses_owned small=true error.error="AI_APICallError: Free usage limit reached."\n');
      entered();
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("Dani background call aborted");
    });
    let settled = false;
    const result = instance.generateText!("synthetic prompt", { model: "opencode/free", signal: caller.signal }).then(
      (value) => { settled = true; return value; },
      (error: unknown) => { settled = true; return error; },
    );
    try {
      await started;
      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(false);
      appendFileSync(logPath, 'level=ERROR session.id=ses_owned small=false error.error="AI_APICallError: Free usage limit reached. Subscribe to OpenCode Go."\n');
      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(true);
      const error = await result;
      expect(error).toMatchObject({ message: expect.stringMatching(/free model.*usage limit/iu) });
      expect(String(error)).not.toMatch(/subscribe|OpenCode|Kilo/iu);
    } finally {
      caller.abort();
      await result;
      await instance.dispose();
      vi.useRealTimers();
    }
  });
});
