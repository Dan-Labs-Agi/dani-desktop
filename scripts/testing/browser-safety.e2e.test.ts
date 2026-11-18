import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../control-omb.ts";
import { BrowserCalls } from "../../server/browser-calls.ts";
import { agentBrowserIntegration, browserDaemonFile, browserSessionId, closeBrowserSession, interruptBrowserSession, prepareBrowserSessionState } from "../../server/browser-engine.ts";
import { BrowserRuntime, browserRuntimeEnv, type BrowserSpawnSpec } from "../../server/browser-runtime.ts";
import { openGate, type EgressGate } from "../../server/browser/egress/gate.ts";
import { refusalFor } from "../../server/browser/egress/policy.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { browserProcessesRunning, browserProcessTree } from "../../server/browser-processes.ts";

const binaryPath = process.env.OMB_AGENT_BROWSER_PATH;
const executablePath = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
const run = binaryPath && executablePath ? it : it.skip;
const runPosix = binaryPath && executablePath && process.platform !== "win32" ? it : it.skip;
const CANARY = "browser-private-fixture-8d24";
type Step = { server: "browser"; tool: string; arguments: Record<string, unknown> };
type Card = { requestId: string; tool?: string; subtitle?: string; answered?: string };

async function setup(hanging = false) {
  const effects: string[] = [];
  let started = false;
  let independentStarted = false;
  const independent = Promise.withResolvers<void>();
  const target = createServer(async (req, res) => {
    if (req.url === "/started") started = true;
    if (req.url === "/independent-held") {
      independentStarted = true;
      await independent.promise;
      res.end("released");
      return;
    }
    if (req.url === "/receipt" || req.url === "/input") {
      let body = "";
      for await (const chunk of req) body += chunk;
      effects.push(`${req.url}:${body}`);
      res.end("recorded");
      return;
    }
    res.setHeader("content-type", "text/html");
    if (req.url === "/read-effect") {
      res.end("<!doctype html><title>Effectful read</title><script>fetch('/receipt',{method:'POST',body:'native-read-write'})</script>");
      return;
    }
    res.end(`<!doctype html><title>Browser safety fixture</title>
      <form method="post" action="/receipt"><label>Message<input id="message" name="message"
      oninput="fetch('/input',{method:'POST',body:this.value})"></label><button id="send">Send</button></form>`);
  });
  const listening = Promise.withResolvers<void>();
  target.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("fixture target did not bind");
  const page = `http://127.0.0.1:${address.port}/`;
  let fixture: VerificationServer;
  try {
    fixture = await launchVerificationServer(hanging ? { FAKE_CLAUDE_MODE: "hang" } : {}, undefined, undefined,
      { binaryPath: binaryPath!, executablePath: executablePath! }, undefined, hanging ? undefined : { scripted: true });
  } catch (error) {
    target.closeAllConnections();
    const closed = Promise.withResolvers<void>();
    target.close(() => closed.resolve());
    await closed.promise;
    throw error;
  }
  const { url, dataDir, logPath } = fixture.info;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { origin: url, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    expect(response.status, `${method} ${path}`).toBeLessThan(300);
    return value;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", url]);
  const plans: Record<string, unknown> = {};
  await api("PATCH", "/api/config", { features: { browser: true }, browserEngine: { egress: { allow: ["127.0.0.1"] } } });
  return {
    effects, page, api, control, url, dumpPath: fixture.fixtureDumpPath, started: () => started,
    independentStarted: () => independentStarted, releaseIndependent: independent.resolve,
    logs: () => readFileSync(logPath, "utf8"),
    async bot(name: string, approvalMode: "ask" | "full", steps: Step[]) {
      const { bot } = await api("POST", "/api/bots", { name });
      await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", approvalMode, applyToAllThreads: true });
      plans[bot.id] = { turns: [{ timeoutMs: 90_000, steps, reply: "Browser fixture ended." }] };
      writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify(plans));
      await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Run the browser fixture."]);
      return bot as { id: string; threadId: string };
    },
    async resume(bot: { id: string; threadId: string }, steps: Step[]) {
      plans[bot.id] = { steps, resumeSteps: steps, reply: "Recovery fixture ended." };
      writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify(plans));
      await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Run the recovery fixture."]);
    },
    async observeProcesses(bot: { id: string }) {
      const session = browserSessionId(bot.id, "");
      const env = { HOME: dataDir, USERPROFILE: dataDir, AGENT_BROWSER_SESSION: session };
      const pid = Number(readFileSync(browserDaemonFile(env, ".pid"), "utf8").trim());
      const tree = await browserProcessTree(binaryPath!, pid, session);
      if (!tree) throw new Error("Could not observe the fixture browser's process identities");
      return tree;
    },
    async cards(threadId: string): Promise<Card[]> {
      const { messages } = await api("GET", `/api/threads/${threadId}/messages`);
      return messages.flatMap((row: { card?: Card }) => row.card?.requestId && !row.card.answered ? [row.card] : []);
    },
    answer: (threadId: string, requestId: string, behavior: "allow" | "deny") => api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior }),
    async close() {
      independent.resolve();
      await fixture.close();
      target.closeAllConnections();
      const closed = Promise.withResolvers<void>();
      target.close(() => closed.resolve());
      await closed.promise;
    },
  };
}

const step = (tool: string, args: Record<string, unknown>): Step => ({ server: "browser", tool: `agent_browser_${tool}`, arguments: args });

run("blocks scripted writes before approval and never exposes their private arguments", async () => {
  const f = await setup();
  try {
    const bot = await f.bot("Browser approval fixture", "ask", [
      step("open", { url: f.page }), step("fill", { selector: "#message", text: CANARY }), step("click", { selector: "#send" }),
    ]);
    for (let i = 0; i < 2; i++) {
      await expect.poll(async () => (await f.cards(bot.threadId)).length > 0 || f.effects.length > 0, { timeout: 30_000 }).toBe(true);
      expect(f.effects).toEqual([]);
      const [card] = await f.cards(bot.threadId);
      expect(card).toBeDefined();
      expect(JSON.stringify(card)).not.toContain(CANARY);
      expect(JSON.stringify(card)).not.toContain("#message");
      expect(card.subtitle).toContain("<REDACTED>");
      await f.answer(bot.threadId, card.requestId, i === 0 ? "allow" : "deny");
    }
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(f.effects).toEqual([]);
    expect(f.logs()).not.toContain(CANARY);
  } finally { await f.close(); }
}, 150_000);

run("executes each approved browser call once and keeps Full Access free of duplicate cards", async () => {
  const f = await setup();
  try {
    const bot = await f.bot("Approved browser fixture", "ask", [step("open", { url: f.page }), step("fill", { selector: "#message", text: CANARY }), step("click", { selector: "#send" })]);
    const answered = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await expect.poll(async () => (await f.cards(bot.threadId)).some((card) => !answered.has(card.requestId)), { timeout: 30_000 }).toBe(true);
      const card = (await f.cards(bot.threadId)).find((candidate) => !answered.has(candidate.requestId))!;
      answered.add(card.requestId);
      await f.answer(bot.threadId, card.requestId, "allow");
    }
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(f.effects.filter((effect) => effect.startsWith("/receipt:"))).toEqual([`/receipt:message=${CANARY}`]);
    const full = await f.bot("Full browser fixture", "full", [step("open", { url: f.page }), step("click", { selector: "#send" })]);
    await f.control(["wait", "--bot", full.id, "--task", full.threadId, "--timeout", "30"]);
    expect(await f.cards(full.threadId)).toEqual([]);
    expect(f.effects.filter((effect) => effect.startsWith("/receipt:"))).toEqual([`/receipt:message=${CANARY}`, "/receipt:message="]);
  } finally { await f.close(); }
}, 150_000);

run("Stop terminates an accepted delayed submission without interrupting a different browser", async () => {
  const f = await setup();
  try {
    const other = await f.bot("Independent browser fixture", "full", [
      step("open", { url: f.page }),
      step("eval", { script: "(async () => { await fetch('/independent-held'); await fetch('/receipt', { method: 'POST', body: 'independent-write' }); return 'completed'; })()" }),
    ]);
    await expect.poll(f.independentStarted, { timeout: 30_000 }).toBe(true);
    const slow = await f.bot("Cancelled browser fixture", "full", [
      step("open", { url: f.page }),
      step("eval", { script: "(async () => { await fetch('/started'); const delay = Promise.withResolvers(); setTimeout(delay.resolve, 12000); await delay.promise; await fetch('/receipt', { method: 'POST', body: 'cancelled-write' }); return 'submitted'; })()" }),
    ]);
    await expect.poll(f.started, { timeout: 30_000 }).toBe(true);
    const cancelledTree = process.platform === "win32" ? null : await f.observeProcesses(slow);
    await f.control(["interrupt", "--bot", slow.id, "--task", slow.threadId]);
    if (cancelledTree) await expect.poll(() => browserProcessesRunning(cancelledTree), { timeout: 15_000 }).toBe(false);
    f.releaseIndependent();
    await f.control(["wait", "--bot", other.id, "--task", other.threadId, "--timeout", "30"]);
    // Chrome's page timers run in another process; fake Node timers cannot advance its delayed POST.
    await sleep(13_000);
    expect(f.effects.filter((effect) => effect.startsWith("/receipt:"))).toEqual(["/receipt:independent-write"]);
    await f.resume(slow, [
      step("open", { url: f.page }),
      step("eval", { script: "fetch('/receipt', { method: 'POST', body: 'recovery-write' }).then(() => 'recovered')" }),
    ]);
    await f.control(["wait", "--bot", slow.id, "--task", slow.threadId, "--timeout", "30"]);
    expect(f.effects.filter((effect) => effect.startsWith("/receipt:"))).toEqual(["/receipt:independent-write", "/receipt:recovery-write"]);
  } finally { await f.close(); }
}, 150_000);

run.each(["allow", "deny"] as const)("Chat Completions uses one server approval per browser action without a second driver card (%s)", async (decision) => {
  const f = await setup();
  const requested = [
    { name: "agent_browser_open", arguments: { url: f.page } },
    { name: "agent_browser_fill", arguments: { selector: "#message", text: CANARY } },
    { name: "agent_browser_click", arguments: { selector: "#send" } },
  ];
  let providerRequests = 0;
  const provider = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "browser-fixture-model" }] }));
      return;
    }
    if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
    let text = "";
    for await (const part of req) text += part;
    providerRequests += 1;
    const body = JSON.parse(text) as { messages: Array<{ role: string }>; tools?: Array<{ function: { name: string } }> };
    const index = body.messages.filter((message) => message.role === "tool").length;
    const action = requested[index];
    const name = action && body.tools?.find((tool) => tool.function.name.endsWith(action.name))?.function.name;
    const delta = action
      ? { tool_calls: [{ index: 0, id: `browser-call-${index}`, type: "function", function: { name, arguments: JSON.stringify(action.arguments) } }] }
      : { content: "Browser fixture completed." };
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: action ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  const listening = Promise.withResolvers<void>();
  provider.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  try {
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("fixture provider did not bind");
    const endpoint = await f.api("POST", "/api/instances/openai-compat", {
      displayName: "Browser fixture model", key: "synthetic-browser-fixture-key",
      url: `http://127.0.0.1:${address.port}/v1`, models: ["browser-fixture-model"],
    });
    const { bot } = await f.api("POST", "/api/bots", { name: "Chat browser fixture" });
    await f.control(["set-model", "--bot", bot.id, "--instance", endpoint.instanceId, "--model", "browser-fixture-model"]);
    await f.api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", approvalMode: "ask", applyToAllThreads: true });
    await f.control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Complete the browser fixture."]);
    const answered = new Set<string>();
    for (let index = 0; index < requested.length; index++) {
      await expect.poll(async () => (await f.cards(bot.threadId)).some((card) => !answered.has(card.requestId)), { timeout: 30_000 }).toBe(true);
      const card = (await f.cards(bot.threadId)).find((candidate) => !answered.has(candidate.requestId))!;
      expect(card.tool).toBe(requested[index].name);
      expect(JSON.stringify(card)).not.toContain(CANARY);
      answered.add(card.requestId);
      await f.answer(bot.threadId, card.requestId, index === requested.length - 1 ? decision : "allow");
    }
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(await f.cards(bot.threadId)).toEqual([]);
    expect(f.effects.filter((effect) => effect.startsWith("/receipt:"))).toEqual(decision === "allow" ? [`/receipt:message=${CANARY}`] : []);
    expect(providerRequests).toBe(4);
  } finally {
    provider.closeAllConnections();
    const closed = Promise.withResolvers<void>();
    provider.close(() => closed.resolve());
    await closed.promise;
    await f.close();
  }
}, 150_000);

run("a native read with a URL cannot navigate or write before its exact approval", async () => {
  const f = await setup();
  try {
    await f.api("PATCH", "/api/config", { browserEngine: { engine: "chrome" } });
    const bot = await f.bot("Native read approval fixture", "ask", [step("read", { url: `${f.page}read-effect` })]);
    await expect.poll(async () => (await f.cards(bot.threadId)).length > 0 || f.effects.length > 0, { timeout: 30_000 }).toBe(true);
    expect(f.effects).toEqual([]);
    const [card] = await f.cards(bot.threadId);
    expect(card.tool).toBe("agent_browser_read");
    await f.answer(bot.threadId, card.requestId, "deny");
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(f.effects).toEqual([]);
  } finally { await f.close(); }
}, 90_000);

runPosix("revoking a turn stops a delayed browser effect after the RPC already timed out", async () => {
  const f = await setup();
  const home = mkdtempSync(join(tmpdir(), "dani-lost-browser-"));
  const sockets = mkdtempSync("/tmp/dani-lost-socket-");
  mkdirSync(join(home, "tmp"));
  const session = `lost-${randomBytes(6).toString("hex")}`;
  const broker = new BrowserCalls({ publish: () => {} });
  let gate: EgressGate | undefined;
  let spec: BrowserSpawnSpec | undefined;
  let warm: BrowserRuntime | undefined;
  let runtime: BrowserRuntime | undefined;
  try {
    gate = await openGate({ decide: (destination, addresses) => refusalFor(destination, addresses, {
      host: "desktop", ownPort: () => false, botPort: async () => false, localNetwork: true, allowed: () => false,
    }) });
    const integration = agentBrowserIntegration({
      binaryPath: binaryPath!, session, encryptionKey: randomBytes(32).toString("hex"), persistent: false, egressPort: gate.port, dataDir: home,
      env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, AGENT_BROWSER_SOCKET_DIR: sockets, AGENT_BROWSER_EXECUTABLE_PATH: executablePath! },
    });
    spec = { ...integration, env: { ...integration.env, HOME: home, USERPROFILE: home, TMPDIR: join(home, "tmp"), AGENT_BROWSER_SOCKET_DIR: sockets } };
    await prepareBrowserSessionState(spec.command, session, { env: spec.env, persistent: false });
    const lifecycle = {
      closeBrowser: (name: string, value: BrowserSpawnSpec) => closeBrowserSession(value.command, browserRuntimeEnv({ ...value.env, AGENT_BROWSER_SESSION: name })),
      interruptBrowser: (name: string, value: BrowserSpawnSpec) => interruptBrowserSession(value.command, browserRuntimeEnv({ ...value.env, AGENT_BROWSER_SESSION: name })),
    };
    warm = new BrowserRuntime(lifecycle);
    expect(await warm.agentRpc(session, spec, "tools/call", { name: "agent_browser_open", arguments: { url: f.page } })).not.toHaveProperty("isError", true);
    await warm.close(session);
    const observedPid = Number(readFileSync(browserDaemonFile(spec.env, ".pid"), "utf8").trim());
    const observedTree = await browserProcessTree(spec.command, observedPid, session);
    if (!observedTree) throw new Error("Could not observe the accepted browser's process identities");
    runtime = new BrowserRuntime({ ...lifecycle, requestTimeoutMs: 1_000, callBudgetMs: 5_000, followUpReserveMs: 500 });
    const params = { name: "agent_browser_eval", arguments: { script: "(async () => { await fetch('/started'); const delay = Promise.withResolvers(); setTimeout(delay.resolve, 5000); await delay.promise; await fetch('/receipt', { method: 'POST', body: 'lost-call-write' }); return 'submitted'; })()" } };
    const result = await broker.run({
      botId: "lost-bot", threadId: "lost-thread", generation: "lost-generation", session,
      provider: "fixture", providerInstanceId: "fixture", method: "tools/call", params,
      signal: new AbortController().signal, assertActive: () => {}, fullAccessNow: () => true,
      outcomeUnknown: () => runtime!.interrupted(session),
    }, (signal) => runtime!.agentRpc(session, spec!, "tools/call", params, undefined, undefined, signal));
    expect(result).toHaveProperty("isError", true);
    expect(f.started()).toBe(true);
    expect(runtime.interrupted(session)).toBe(true);
    broker.cancelTurn("lost-thread", "lost-generation");
    await expect.poll(() => runtime!.interrupted(session), { timeout: 15_000 }).toBe(false);
    expect(await browserProcessesRunning(observedTree)).toBe(false);
    // Chrome owns this delayed timer in another process; host fake timers cannot advance it.
    await sleep(5_500);
    expect(f.effects).toEqual([]);
  } finally {
    broker.cancelAll();
    if (spec) await closeBrowserSession(spec.command, browserRuntimeEnv({ ...spec.env, AGENT_BROWSER_SESSION: session }));
    await runtime?.closeAll();
    await warm?.closeAll();
    await gate?.close();
    await removeTempDir(home);
    await removeTempDir(sockets);
    await f.close();
  }
}, 90_000);

runPosix("native HTTP MCP cancellation terminates accepted work and permits same-session recovery", async () => {
  const f = await setup(true);
  try {
    const bot = await f.bot("HTTP cancellation fixture", "full", []);
    await expect.poll(() => existsSync(f.dumpPath), { timeout: 15_000 }).toBe(true);
    const dump = JSON.parse(readFileSync(f.dumpPath, "utf8"));
    const token = dump.mcpConfig.mcpServers.browser.env.OMB_MCP_TOKEN_BROWSER;
    expect(typeof token).toBe("string");
    const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${token}` };
    const http = (frame: unknown) => fetch(`${f.url}/api/internal/mcp-http/browser`, { method: "POST", headers, body: JSON.stringify(frame) });
    const initialized = await http({ jsonrpc: "2.0", id: 1, method: "initialize" });
    headers["mcp-session-id"] = initialized.headers.get("mcp-session-id")!;
    await initialized.json();
    let nextId = 2;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const response = await http({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } });
      return await response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: unknown };
    };
    expect(JSON.stringify(await rpc("agent_browser_open", { url: f.page }))).toContain("Browser safety fixture");
    const callId = nextId;
    const accepted = rpc("agent_browser_eval", { script: "(async () => { await fetch('/started'); const delay = Promise.withResolvers(); setTimeout(delay.resolve, 5000); await delay.promise; await fetch('/receipt', { method: 'POST', body: 'http-cancelled-write' }); })()" });
    await expect.poll(f.started, { timeout: 15_000 }).toBe(true);
    const tree = await f.observeProcesses(bot);
    const cancellation = await http({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: callId } });
    expect(cancellation.status).toBe(202);
    expect(await accepted).toHaveProperty("result.isError", true);
    await expect.poll(() => browserProcessesRunning(tree), { timeout: 15_000 }).toBe(false);
    // The delayed write is scheduled in real Chrome, outside the host's fake clock.
    await sleep(5_500);
    expect(f.effects).toEqual([]);
    await expect.poll(async () => {
      const reply = await rpc("agent_browser_get_url", {});
      return reply.result !== undefined && reply.result.isError !== true;
    }, { timeout: 15_000 }).toBe(true);
    const recovered = await rpc("agent_browser_open", { url: f.page });
    expect(JSON.stringify(recovered)).toContain("Browser safety fixture");
    expect(f.effects).toEqual([]);
  } finally { await f.close(); }
}, 90_000);
