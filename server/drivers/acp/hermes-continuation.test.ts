import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ProviderInstance, SendTurnInput } from "../../contracts.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { recordEvents } from "../../testing/events.ts";
import { OBSERVATION_RECOVERY_LIMIT, TASK_ROUND_LIMIT, TASK_TOOL_CALL_LIMIT } from "../task-continuation.ts";
import { HermesAgentDriver, HERMES_CONFIG_MODEL_ID } from "./hermes.ts";
import type * as ModelCatalogModule from "./hermes-model-catalog.ts";

vi.mock("./hermes-model-catalog.ts", async (importOriginal) => {
  const catalog = await importOriginal<typeof ModelCatalogModule>();
  return {
    ...catalog,
    buildHermesModelCatalog: (...args: Parameters<typeof catalog.buildHermesModelCatalog>) => {
      const [, configured, local, repository, free, extra] = args;
      return catalog.buildHermesModelCatalog({
        providers: [{ id: "openai-codex", label: "Codex", models: ["gpt-continuation-fixture"], authenticatedModels: ["gpt-continuation-fixture"], toolModels: ["gpt-continuation-fixture"] }],
      }, configured, local, repository, free, extra);
    },
  };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close(); });

interface Stage {
  text?: string;
  tools?: number;
  status?: "completed" | "failed" | "in_progress";
  kind?: "read" | "search" | "other";
  title?: string;
  plan?: "pending" | "in_progress" | "completed";
  permission?: boolean;
  openQuestion?: boolean;
  hold?: boolean;
  rpcError?: string;
  rpcErrorAfterTools?: string;
  stopReason?: string;
  duplicateCompletion?: boolean;
  orphanCompletion?: boolean;
  used?: number;
  nativeId?: string;
  unkeyed?: boolean;
  input?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number; cachedReadTokens?: number; totalTokens?: number } | false;
}
interface FixtureOptions { phases?: number; stages?: Stage[]; reuseIds?: boolean }
interface Receipt { step: number; session: string }
interface PromptReceipt extends Receipt { prompt: Array<{ type: string; text?: string }> }

const CLI = `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
let step = 0;
let heldPrompt;
const awaiting = new Map();
const config = JSON.parse(process.env.FIXTURE_SCENARIO);
const send = message => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', ...message })+'\\n');
const reply = (id, result) => send({id,result});
const update = value => send({method:'session/update',params:{sessionId:'continuation-session',update:value}});
createInterface({ input:process.stdin }).on('line', async line => {
  const message = JSON.parse(line);
  if (awaiting.has(message.id)) { awaiting.get(message.id)(message.result); awaiting.delete(message.id); return; }
  if (message.method === 'session/cancel') { if (heldPrompt !== undefined) reply(heldPrompt,{stopReason:'end_turn'}); return; }
  if (message.id === undefined) return;
  if (message.method === 'initialize') return reply(message.id,{protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[]});
  if (message.method === 'session/new' || message.method === 'session/load') return reply(message.id,{sessionId:'continuation-session'});
  if (message.method === 'session/prompt') {
    step += 1;
    appendFileSync(process.env.FIXTURE_PROMPTS,JSON.stringify({step,session:message.params.sessionId,prompt:message.params.prompt})+'\\n');
    const stage = config.stages?.[step-1] ?? {tools:config.phases > 0 ? 1 : 0,text:config.phases > 0 && step >= config.phases ? 'All ten workflow stages are verified.' : "I'll inspect the next browser result."};
    if (stage.rpcError) return send({id:message.id,error:{code:-32603,message:stage.rpcError}});
    if (stage.plan) update({sessionUpdate:'plan',entries:[{content:'Remaining workflow',priority:'medium',status:stage.plan}]});
    if (stage.used) update({sessionUpdate:'usage_update',used:stage.used,size:10000});
    if (stage.openQuestion) send({id:'question-'+step,method:'session/request_permission',params:{sessionId:'continuation-session',toolCall:{toolCallId:'interaction_'+step,title:'Which account?',kind:'other'},options:[{optionId:'answer',kind:'allow_once',name:'Test account'}]}});
    for (let index=0; index<(stage.tools ?? 0); index++) {
      const id = stage.nativeId ?? (config.reuseIds ? 'browser-step' : 'browser-step-'+step)+'-'+index;
      update({sessionUpdate:'tool_call',toolCallId:stage.unkeyed ? undefined : id,title:stage.title ?? 'browser step '+step,kind:stage.kind ?? 'other',status:'pending',rawInput:stage.input ?? {step,index}});
      if (stage.permission) {
        const requestId = 'permission-'+step+'-'+index;
        const {promise:outcome,resolve} = Promise.withResolvers();
        awaiting.set(requestId,resolve);
        send({id:requestId,method:'session/request_permission',params:{sessionId:'continuation-session',toolCall:{toolCallId:id,title:'Browser action',kind:'other'},options:[{optionId:'allow',kind:'allow_once',name:'Allow'},{optionId:'deny',kind:'reject_once',name:'Deny'}]}});
        const result = await outcome;
        appendFileSync(process.env.FIXTURE_PERMISSIONS,JSON.stringify({step,index,result})+'\\n');
      }
      const status = stage.status ?? 'completed';
      if (status === 'completed') appendFileSync(process.env.FIXTURE_RECEIPTS,JSON.stringify({step,session:message.params.sessionId})+'\\n');
      update({sessionUpdate:'tool_call_update',toolCallId:stage.unkeyed ? undefined : id,status,rawOutput:{output:'verified step '+step}});
      if (stage.duplicateCompletion) update({sessionUpdate:'tool_call_update',toolCallId:stage.unkeyed ? undefined : id,status,rawOutput:{output:'duplicate native notification'}});
    }
    if (stage.rpcErrorAfterTools) return send({id:message.id,error:{code:-32603,message:stage.rpcErrorAfterTools}});
    if (stage.orphanCompletion) update({sessionUpdate:'tool_call_update',toolCallId:'unknown-tool',status:'completed'});
    if (stage.text) update({sessionUpdate:'agent_message_chunk',messageId:'same-native-message',content:{type:'text',text:stage.text}});
    if (stage.hold) { heldPrompt = message.id; return; }
    return reply(message.id,{stopReason:stage.stopReason ?? 'end_turn',...(stage.usage === false ? {} : {_meta:stage.usage ?? {inputTokens:10,outputTokens:5}})});
  }
  reply(message.id,{});
}).on('close',()=>process.exit(0));
`;

async function fixture(options: number | FixtureOptions) {
  const scenario = typeof options === "number" ? { phases: options } : options;
  const home = mkdtempSync(join(tmpdir(), "dani-hermes-continuation-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const cli = join(bin, "hermes");
  const receipts = join(home, "receipts.jsonl");
  const prompts = join(home, "prompts.jsonl");
  const permissions = join(home, "permissions.jsonl");
  writeFileSync(cli, CLI, { mode: 0o700 });
  writeFileSync(join(bin, "python3"), `#!${process.execPath}
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2);
if (args.includes("--runtime-info") || args.includes("--qualify-route")) {
  const runtime = { version: "0.21.3", configuredProvider: "openai-codex", resolvedProvider: "openai-codex",
    model: "gpt-continuation-fixture", endpoint: "https://chatgpt.com/backend-api/codex", apiMode: "codex_responses",
    credentialFingerprint: "a".repeat(64), credentialHeaderNames: [] };
  const fields = ["version", "configuredProvider", "resolvedProvider", "model", "endpoint", "apiMode"];
  const fingerprint = createHash("sha256").update(JSON.stringify(fields.map(key => runtime[key]))).digest("hex");
  console.log(JSON.stringify(args.includes("--qualify-route") ? { schemaVersion: 1, qualified: true,
    toolCallCount: 1, resultConsumed: true, fingerprint, credentialFingerprint: runtime.credentialFingerprint } : runtime));
} else if (args[0]?.endsWith("hermes-model-metadata.py")) {
  console.log(JSON.stringify({ providers: [] }));
} else {
  await import(pathToFileURL(${JSON.stringify(cli)}).href);
}
`, { mode: 0o700 });
  writeFileSync(join(home, "config.yaml"), "model:\n  provider: openai-codex\n  default: gpt-continuation-fixture\n");
  let instance: ProviderInstance;
  try {
    instance = await HermesAgentDriver.create({
      instanceId: "hermes-continuation", displayName: "Hermes", enabled: true,
      environment: { HERMES_HOME: home, HOME: home, USERPROFILE: home, FIXTURE_SCENARIO: JSON.stringify(scenario), FIXTURE_RECEIPTS: receipts, FIXTURE_PROMPTS: prompts, FIXTURE_PERMISSIONS: permissions },
      config: HermesAgentDriver.decodeConfig({ cli }),
    });
  } catch (error) { await removeTempDir(home); throw error; }
  const recorder = recordEvents(instance.adapter);
  cleanups.push(async () => { recorder.stop(); await instance.dispose(); await removeTempDir(home); });
  const rows = <T>(path: string): T[] => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((row) => JSON.parse(row) as T) : [];
  return {
    recorder,
    adapter: instance.adapter,
    start: (turn: Partial<SendTurnInput> = {}) => instance.adapter.sendTurn({
      threadId: "workflow-thread", model: HERMES_CONFIG_MODEL_ID, text: "Complete all ten workflow stages, not only the first stage.", ...turn,
    }),
    receipts: () => rows<Receipt>(receipts),
    prompts: () => rows<PromptReceipt>(prompts),
    permissions: () => rows<{ step: number; result: unknown }>(permissions),
  };
}

const promise = "I'll inspect the next browser result.";

it("does not report task completion when Hermes ends its native response with only an unfinished action", async () => {
  const f = await fixture(0);
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.receipts()).toEqual([]);
  expect(f.prompts()).toHaveLength(2);
});

it("keeps one agent turn and session working through ten progress-making phases before completing", async () => {
  const f = await fixture(10);
  const started = await f.start();
  const completed = await f.recorder.until((event) => event.type === "turn.completed");
  expect(completed).toMatchObject({ ok: true, turnId: started.turnId });
  expect(f.receipts()).toEqual(Array.from({ length: 10 }, (_, index) => ({ step: index + 1, session: "continuation-session" })));
  expect(f.recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  expect(f.recorder.events.filter((event) => event.type === "turn.started")).toHaveLength(1);
  const usage = f.recorder.events.filter((event) => event.type === "thread.token-usage.updated");
  expect(usage.at(-1)).toMatchObject({ input: 100, output: 50 });
});

it.each(["pending", "in_progress"] as const)("continues a structured %s plan without a next-action announcement", async (plan) => {
  const f = await fixture({ stages: [{ tools: 1, plan, text: "The first stage is verified." }, { tools: 1, plan: "completed", text: "All requested stages are verified." }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.recorder.events.filter(event => event.type === "turn.work-status")).toEqual([
    expect.objectContaining({ status: "remaining" }),
    expect.objectContaining({ status: "complete" }),
  ]);
  expect(f.receipts()).toHaveLength(2);
});

it("does not mistake plan rewording for actual progress", async () => {
  const f = await fixture({ stages: [{ plan: "pending", text: "Stage one remains." }, { plan: "in_progress", text: "Working through the remaining stage." }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.recorder.events.filter(event => event.type === "turn.work-status").at(-1)).toMatchObject({ status: "remaining" });
  expect(f.prompts()).toHaveLength(2);
});

it("namespaces reused native tool IDs and correlates later-prompt permission responses", async () => {
  const f = await fixture({ reuseIds: true, stages: [{ tools: 1, text: promise }, { tools: 1, permission: true, text: "Verified both stages." }] });
  await f.start();
  const opened = await f.recorder.until((event) => event.type === "request.opened");
  if (opened.type !== "request.opened" || !opened.requestId) throw new Error("expected permission request");
  expect(await f.adapter.respondToRequest("workflow-thread", opened.requestId, { behavior: "allow" })).toBe("allowed-once");
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  const tools = f.recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "tool");
  const started = f.recorder.events.filter((event) => event.type === "item.started" && event.itemType === "tool");
  expect(new Set(started.map((event) => event.itemId)).size).toBe(2);
  expect(tools.map((event) => event.itemId)).toEqual(started.map((event) => event.itemId));
  expect(f.permissions()).toEqual([{ step: 2, index: 0, result: { outcome: { outcome: "selected", optionId: "allow" } } }]);
  expect(f.receipts()).toHaveLength(2);
});

it("keeps native keys disjoint from synthetic IDs so later tool progress is not lost", async () => {
  const f = await fixture({ stages: [
    { tools: 1, nativeId: "acp-tool-unkeyed-1", text: promise },
    { tools: 1, unkeyed: true, text: promise },
    { tools: 1, text: "All three stages are verified." },
  ] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.receipts().map((receipt) => receipt.step)).toEqual([1, 2, 3]);
  const ended = f.recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "tool");
  expect(new Set(ended.map((event) => event.itemId)).size).toBe(3);
});

it("keeps cumulative root-turn usage through cache normalization and a context-only final phase", async () => {
  const f = await fixture({ stages: [
    { tools: 1, used: 1000, text: promise, usage: { inputTokens: 10, outputTokens: 5, cachedReadTokens: 7, totalTokens: 22 } },
    { tools: 1, used: 400, text: promise, usage: { inputTokens: 9, outputTokens: 2, cachedReadTokens: 3, totalTokens: 11 } },
    { used: 450, usage: false, text: "Both operations are verified." },
  ] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  const usage = f.recorder.events.filter((event) => event.type === "thread.token-usage.updated");
  expect(usage.at(-1)).toMatchObject({ input: 26, output: 7, cachedInput: 10, contextTokens: 450 });
});

it("preserves Stop during a continued prompt without starting another phase", async () => {
  const f = await fixture({ stages: [{ tools: 1, text: promise }, { text: "Still inspecting the stage.", hold: true }] });
  await f.start();
  await f.recorder.until((event) => event.type === "content.delta" && event.delta === "Still inspecting the stage.");
  await f.adapter.interruptTurn("workflow-thread");
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "cancelled" });
  expect(f.prompts()).toHaveLength(2);
  expect(f.receipts()).toHaveLength(1);
});

it("does not report native cancellation as successful completion or replay accepted work", async () => {
  const f = await fixture({ stages: [{ tools: 1, text: "The turn was cancelled.", stopReason: "cancelled" }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "cancelled" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts().map(receipt => receipt.step)).toEqual([1]);
});

it("never nudges after a denied action even when the native CLI marks the tool completed", async () => {
  const f = await fixture({ stages: [{ tools: 1, permission: true, text: promise }] });
  await f.start();
  const opened = await f.recorder.until((event) => event.type === "request.opened");
  if (opened.type !== "request.opened" || !opened.requestId) throw new Error("expected permission request");
  await f.adapter.respondToRequest("workflow-thread", opened.requestId, { behavior: "deny" });
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.permissions()).toEqual([{ step: 1, index: 0, result: { outcome: { outcome: "selected", optionId: "deny" } } }]);
});

it.each<Stage>([
  { tools: 1, status: "failed", text: promise },
  { tools: 1, status: "in_progress", text: promise },
  { orphanCompletion: true, text: promise },
])("does not continue failed or unknown native work: %j", async (stage) => {
  const f = await fixture({ stages: [stage] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
});

it("does not continue while a native human question remains open", async () => {
  const f = await fixture({ stages: [{ plan: "pending", openQuestion: true, text: promise }] });
  await f.start();
  await f.recorder.until((event) => event.type === "turn.completed");
  expect(f.prompts()).toHaveLength(1);
  expect(f.recorder.events.some((event) => event.type === "request.opened" && event.requestType === "question")).toBe(true);
});

it("does not override a human question in text with a pending native plan", async () => {
  const f = await fixture({ stages: [{ plan: "pending", text: "Which account should I use?" }] });
  await f.start();
  await f.recorder.until((event) => event.type === "turn.completed");
  expect(f.prompts()).toHaveLength(1);
});

it("preserves a continued prompt's real RPC error", async () => {
  const f = await fixture({ stages: [{ tools: 1, text: promise }, { rpcError: "HTTP 503 synthetic provider outage" }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "rpc_error" });
  expect(f.recorder.events.some((event) => event.type === "runtime.error" && event.message.includes("server problem"))).toBe(true);
  expect(f.prompts()).toHaveLength(2);
});

it("recognizes a provider error body in a later prompt despite an earlier flushed reply", async () => {
  const f = await fixture({ stages: [{ tools: 1, text: promise }, { text: '402 {"error":{"message":"Insufficient credits"}}' }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "auth_required" });
  expect(f.recorder.events.some((event) => event.type === "runtime.error" && event.message.includes("out of credits"))).toBe(true);
  expect(f.prompts()).toHaveLength(2);
});

it("does not treat an earlier phase's flushed promise as this prompt's completion", async () => {
  const f = await fixture({ stages: [{ tools: 1, text: promise }, {}] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "empty_turn" });
  expect(f.prompts()).toHaveLength(2);
});

it("retains the 64-round continuation boundary while effects keep progressing", async () => {
  const f = await fixture({ phases: TASK_ROUND_LIMIT + 10 });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(TASK_ROUND_LIMIT);
  expect(f.receipts()).toHaveLength(TASK_ROUND_LIMIT);
});

it("retains the 200-tool boundary and deduplicates native completion notifications", async () => {
  const f = await fixture({ stages: [
    { tools: TASK_TOOL_CALL_LIMIT / 2, duplicateCompletion: true, text: promise },
    { tools: TASK_TOOL_CALL_LIMIT / 2, duplicateCompletion: true, text: promise },
  ] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(2);
  expect(f.receipts()).toHaveLength(TASK_TOOL_CALL_LIMIT);
  expect(f.recorder.events.filter((event) => event.type === "item.completed" && event.itemType === "tool")).toHaveLength(TASK_TOOL_CALL_LIMIT);
});

it("never nudges after an expired permission request", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const f = await fixture({ stages: [{ tools: 1, permission: true, text: promise }] });
  await f.start();
  await f.recorder.until((event) => event.type === "request.opened");
  const expiry = timers.mock.calls.findLast(([, delay]) => delay === 15 * 60_000);
  if (!expiry || typeof expiry[0] !== "function") throw new Error("expected the native permission expiry timer");
  expiry[0](...expiry.slice(2));
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.permissions()).toEqual([{ step: 1, index: 0, result: { outcome: { outcome: "selected", optionId: "deny" } } }]);
});

it("preserves context compaction across prompts and reanchors the next root turn", async () => {
  const f = await fixture({ stages: [
    { tools: 1, used: 1000, text: promise },
    { tools: 1, used: 400, text: "Both stages are verified." },
    { text: "The next request is complete." },
  ] });
  const system = { system: "Standing rules.\n\nCurrent memory.", systemStable: "Standing rules.", systemVolatile: "Current memory." };
  const first = await f.start(system);
  expect(await f.recorder.until((event) => event.type === "turn.completed" && event.turnId === first.turnId)).toMatchObject({ ok: true });
  const next = await f.start({ ...system, text: "A separate task." });
  expect(await f.recorder.until((event) => event.type === "turn.completed" && event.turnId === next.turnId)).toMatchObject({ ok: true });
  expect(f.prompts()).toHaveLength(3);
  expect(f.prompts()[2]!.prompt[0]!.text).toContain("Standing rules.");
  expect(f.recorder.events.flatMap((event) =>
    event.type === "thread.token-usage.updated" && event.contextTokens !== undefined ? [event.contextTokens] : [],
  )).toEqual([1000, 400]);
});

it("preserves a native turn budget stop instead of adding another client prompt", async () => {
  const f = await fixture({ stages: [{ tools: 1, plan: "pending", text: promise, stopReason: "max_turn_requests" }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "max_turn_requests" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts()).toHaveLength(1);
});

it("recovers failed observations in the same owned task instead of stopping after one try", async () => {
  const failed: Stage = { tools: 1, kind: "other", title: "mcp__browser__agent_browser_snapshot", status: "failed", text: "The page observation failed." };
  const f = await fixture({ stages: [failed, failed, failed, { tools: 1, kind: "read", title: "agent_browser_snapshot", text: "The requested receipt is verified." }] });
  await f.start({ continuationAllowed: (recovery?: "observation") => recovery === "observation" });
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.prompts().map((prompt) => prompt.session)).toEqual(Array(4).fill("continuation-session"));
  expect(f.receipts()).toEqual([{ step: 4, session: "continuation-session" }]);
  expect(f.recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
});

it("bounds failed-observation recovery without replaying a consequential operation", async () => {
  const f = await fixture({ stages: Array.from({ length: 10 }, (): Stage => ({
    tools: 1, kind: "read", title: "agent_browser_snapshot", status: "failed", text: "The page observation failed.",
  })) });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(4);
  expect(f.receipts()).toEqual([]);
});

it("recovers a rejected native prompt only after a correlated failed observation", async () => {
  const f = await fixture({ stages: [
    { tools: 1, kind: "read", title: "agent_browser_snapshot", status: "failed", rpcErrorAfterTools: "The observation request failed." },
    { tools: 1, kind: "read", title: "agent_browser_snapshot", text: "The requested receipt is verified." },
  ] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.prompts()).toHaveLength(2);
  expect(f.receipts()).toEqual([{ step: 2, session: "continuation-session" }]);
});

it("never retries another MCP server's failed operation as a browser observation", async () => {
  const f = await fixture({ stages: [
    { tools: 1, kind: "other", title: "mcp__external__agent_browser_snapshot", status: "failed", text: "The remote operation lost its response." },
    { tools: 1, text: "An unsafe replay ran." },
  ] });
  await f.start();
  expect(await f.recorder.until(event => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts()).toEqual([]);
});

it("never uses observation recovery to override a denied permission", async () => {
  const f = await fixture({ stages: [{ tools: 1, kind: "read", status: "failed", permission: true, text: "The observation failed." }] });
  await f.start();
  const opened = await f.recorder.until((event) => event.type === "request.opened");
  if (!opened.requestId) throw new Error("expected permission request");
  await f.adapter.respondToRequest("workflow-thread", opened.requestId, { behavior: "deny" });
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts()).toEqual([]);
});

const failedWait = (status: Stage["status"] = "failed"): Stage => ({
  tools: 1, kind: "other", title: "mcp__browser__agent_browser_wait: 1s", status, input: { ms: 1_000 }, text: "The page observation failed.",
});
const verified: Stage = { tools: 1, kind: "read", title: "agent_browser_snapshot", text: "The requested receipt is verified." };

it("recovers one stale canonical wait in the same session within the observation bound", async () => {
  const f = await fixture({ stages: [failedWait(), verified] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.prompts().map((prompt) => prompt.session)).toEqual(["continuation-session", "continuation-session"]);
  expect(f.prompts()[1]?.prompt[0]?.text).toContain("Re-read current state");
  expect(f.receipts()).toEqual([{ step: 2, session: "continuation-session" }]);
  expect(f.prompts().length).toBeLessThanOrEqual(OBSERVATION_RECOVERY_LIMIT + 1);
});

it("stops repeated canonical wait failures at the existing observation bound", async () => {
  const f = await fixture({ stages: Array.from({ length: 10 }, () => failedWait()) });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(OBSERVATION_RECOVERY_LIMIT + 1);
  expect(f.receipts()).toEqual([]);
});

it("recovers a correlated failed canonical tab list inside the same observation bound", async () => {
  const failed: Stage = {
    tools: 1, kind: "other", title: "mcp__browser__agent_browser_tabs: list", status: "failed", input: { action: "list" }, text: "The tab list failed.",
  };
  const f = await fixture({ stages: [failed, { ...verified, title: "mcp__browser__agent_browser_tabs: list", input: { action: "list" } }] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.prompts()).toHaveLength(2);
  expect(f.prompts().every((prompt) => prompt.session === "continuation-session")).toBe(true);
  expect(f.prompts()[1]?.prompt[0]?.text).toContain("Re-read current state");
  expect(f.receipts()).toEqual([{ step: 2, session: "continuation-session" }]);
});

it.each(["new", "switch", "close"] as const)("does not recover a failed canonical tab %s as an observation", async (action) => {
  const f = await fixture({ stages: [{
    tools: 1, kind: "read", title: `mcp__browser__agent_browser_tabs: ${action}`, status: "failed",
    input: { action, ...(action === "new" ? { url: "https://example.test/mutate" } : { tab: "t2" }) },
    text: "The tab change failed.",
  }, verified] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts()).toEqual([]);
});

it("does not recover a denied canonical wait as an observation", async () => {
  const f = await fixture({ stages: [{ ...failedWait(), permission: true }, verified] });
  await f.start();
  const opened = await f.recorder.until((event) => event.type === "request.opened");
  if (!opened.requestId) throw new Error("expected permission request");
  await f.adapter.respondToRequest("workflow-thread", opened.requestId, { behavior: "deny" });
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts()).toEqual([]);
});

it("does not refresh a canonical wait after Stop", async () => {
  const f = await fixture({ stages: [failedWait(), { text: "Still waiting on the page.", hold: true }, verified] });
  await f.start();
  await f.recorder.until((event) => event.type === "content.delta" && event.delta === "Still waiting on the page.");
  await f.adapter.interruptTurn("workflow-thread");
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "cancelled" });
  expect(f.prompts()).toHaveLength(2);
  expect(f.receipts()).toEqual([]);
});

it("does not recover a failed URL-bearing read as an observation", async () => {
  const f = await fixture({ stages: [{
    tools: 1, kind: "read", title: "mcp__browser__agent_browser_read: https://example.test/page", status: "failed",
    input: { url: "https://example.test/page" }, text: "The navigated read failed.",
  }, verified] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  expect(f.prompts()).toHaveLength(1);
  expect(f.receipts()).toEqual([]);
});
it("does not mistake quoted page questions and URL queries for a request for human input", async () => {
  const f = await fixture({ stages: [
    { tools: 1, plan: "pending", text: "The page asks “Which draft?” at https://example.test/?draft=42. The receipt still needs verification." },
    { tools: 1, plan: "completed", text: "The requested draft and receipt are verified." },
  ] });
  await f.start();
  expect(await f.recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  expect(f.receipts().map((receipt) => receipt.step)).toEqual([1, 2]);
});
