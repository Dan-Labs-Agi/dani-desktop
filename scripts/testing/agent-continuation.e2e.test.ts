import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import type { VerificationServer } from "../control-omb.ts";
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import { AGENT_BROWSER_VERSION } from "../../server/browser-engine-release.ts";

const binaryPath = process.env.OMB_AGENT_BROWSER_PATH;
const executablePath = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
const run = binaryPath && executablePath ? it : it.skip;
const operations = ["create", "name", "classify", "assign", "schedule", "review", "approve", "publish", "archive", "verify"];
type Step = { server: "browser"; tool: string; arguments: Record<string, unknown> };
type Stage = { steps: Step[]; reply?: string; pendingPlan?: boolean; errorReply?: string };
type Trace = { pid: number; sessionId: string; event: string; stage?: number; toolCallId?: string; tool?: string; status?: string; output?: string; final?: boolean; provider?: string; model?: string };
type Card = { requestId: string; answered?: string };
type Receipt = { stage: number; operation: string; storage: string; cookie: string };
type FixtureBot = { id: string; threadId: string; groupId?: string };
type EventPage = { entries: Array<{ kind: string; data: RuntimeEvent }> };
type MessagePage = { messages: Array<{ card?: Card }> };
const step = (tool: string, args: Record<string, unknown>): Step => ({ server: "browser", tool: `agent_browser_${tool}`, arguments: args });

async function setup() {
  expect(execFileSync(binaryPath!, ["--version"], { encoding: "utf8" }).trim()).toBe(`agent-browser ${AGENT_BROWSER_VERSION}`);
  const token = randomUUID();
  const receipts: Receipt[] = [];
  const attempts: Receipt[] = [];
  const rejected: string[] = [];
  const hold = Promise.withResolvers<void>();
  let held = false;
  let holdDisconnected = false;
  const target = createServer(async (req, res) => {
    if (req.url === "/hold") {
      held = true;
      res.once("close", () => { holdDisconnected = true; });
      await hold.promise;
      res.end("released");
      return;
    }
    if (req.url === "/state") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ stages: receipts.map((receipt) => receipt.stage), complete: receipts.length === operations.length }));
      return;
    }
    if (req.url === "/receipt" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body) as Omit<Receipt, "cookie">;
      const receipt = { ...parsed, cookie: req.headers.cookie ?? "" };
      attempts.push(receipt);
      const accepted = parsed.stage === receipts.length + 1 && parsed.operation === operations[parsed.stage - 1]
        && parsed.storage === token && receipt.cookie.split("; ").includes(`workflow=${token}`);
      if (accepted) receipts.push(receipt);
      else rejected.push(body);
      res.statusCode = accepted ? 200 : 409;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ accepted, stage: parsed.stage }));
      return;
    }
    const stage = Number(/^\/stage\/(\d+)$/.exec(req.url ?? "")?.[1]);
    if (!Number.isInteger(stage) || stage < 1 || stage > operations.length || receipts.length !== stage - 1) {
      res.statusCode = 404;
      res.end("Wrong workflow stage");
      return;
    }
    if (stage === 1) res.setHeader("set-cookie", `workflow=${token}; Path=/; SameSite=Strict`);
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Stage ${stage}: ${operations[stage - 1]}</title>
      <button id="stage-${stage}">${operations[stage - 1]}</button><output id="receipt">pending</output>
      <script>
      ${stage === 1 ? `localStorage.setItem('workflow', ${JSON.stringify(token)});` : ""}
      window.receiptReady = Promise.withResolvers();
      document.querySelector('button').onclick = async () => {
        const response = await fetch('/receipt', { method: 'POST', body: JSON.stringify({
          stage: ${stage}, operation: ${JSON.stringify(operations[stage - 1])}, storage: localStorage.getItem('workflow')
        }) });
        const receipt = await response.json();
        document.querySelector('output').textContent = receipt.accepted ? 'accepted-${stage}' : 'rejected';
        window.receiptReady.resolve(receipt);
      };
      </script>`);
  });
  const listening = Promise.withResolvers<void>();
  target.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("Workflow target did not bind");
  const page = `http://127.0.0.1:${address.port}`;
  let fixture: VerificationServer | undefined;
  const close = async () => {
    hold.resolve();
    await fixture?.close();
    target.closeAllConnections();
    const closed = Promise.withResolvers<void>();
    target.close(() => closed.resolve());
    await closed.promise;
  };
  try {
    fixture = await launchVerificationServer({}, undefined, undefined,
      { binaryPath: binaryPath!, executablePath: executablePath! }, undefined, undefined, ["hermes"]);
    const { url, dataDir } = fixture.info;
    const api = async <T = unknown>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await fetch(url + path, {
        method, headers: { origin: url, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = await response.json() as T;
      expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
      return value;
    };
    const control = (args: string[]) => runControlOmb([...args, "--url", url]);
    const planPath = join(dataDir, "continuation-plan.json");
    const tracePath = join(dataDir, "continuation-trace.jsonl");
    const wrapper = join(dataDir, "workflow-hermes.mjs");
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      "process.env.FAKE_ACP_MODE = 'workflow-plan';",
      `process.env.FAKE_ACP_WORKFLOW_PLAN = ${JSON.stringify(planPath)};`,
      `process.env.FAKE_ACP_WORKFLOW_TRACE = ${JSON.stringify(tracePath)};`,
      `await import(${JSON.stringify(new URL("../../server/testing/fake-acp-cli.ts", import.meta.url).href)});`,
    ].join("\n"), { mode: 0o700 });
    await api("PATCH", "/api/instances/hermes", { cli: wrapper });
    await api("PATCH", "/api/config", { features: { browser: true }, browserEngine: { egress: { allow: ["127.0.0.1"] } } });
    const stages: Stage[] = operations.map((_, index) => {
      const stage = index + 1;
      return {
        steps: [
          step("open", { url: `${page}/stage/${stage}` }),
          step("click", { selector: `#stage-${stage}` }),
          step("eval", { script: `(async () => {
            const receipt = await window.receiptReady.promise;
            if (!receipt.accepted || receipt.stage !== ${stage}) throw new Error('Stage ${stage} was not accepted');
            ${stage === operations.length ? `const state = await fetch('/state').then(response => response.json());
            if (!state.complete || state.stages.join(',') !== '1,2,3,4,5,6,7,8,9,10') throw new Error('Final target state is incomplete');` : ""}
            return 'verified-stage-${stage}';
          })()` }),
        ],
        ...(stage === 4 ? { pendingPlan: true, reply: "Four stages have receipts. Six remain." } : {}),
      };
    });
    return {
      receipts, attempts, rejected, stages, page, token, close, api, control, dataDir,
      held: () => held, holdDisconnected: () => holdDisconnected, release: hold.resolve,
      trace: (): Trace[] => existsSync(tracePath) ? readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [],
      async start(approvalMode: "ask" | "full" = "full", place: "direct" | "room" = "direct") {
        writeFileSync(planPath, JSON.stringify({ stages, reply: "All ten target stages were verified." }));
        const { bot } = await api<{ bot: FixtureBot }>("POST", "/api/bots", { name: "Continuation workflow", modelSelection: { instanceId: "hermes", model: "openai:fixture-a" } });
        await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser", approvalMode, applyToAllThreads: true });
        if (place === "room") {
          const { group } = await api<{ group: { id: string; threadId: string } }>("POST", "/api/groups", {
            name: "Continuation channel", memberIds: [bot.id], setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
          });
          await control(["send-channel", "--channel", group.id, "--text", "Complete all ten local workflow stages, then verify the target state."]);
          return { ...bot, groupId: group.id, threadId: group.threadId };
        }
        await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Complete all ten local workflow stages, then verify the target state."]);
        return bot;
      },
      async events(threadId: string): Promise<RuntimeEvent[]> {
        const page = await api<EventPage>("GET", `/api/threads/${threadId}/events?limit=2000`);
        return page.entries.filter((entry) => entry.kind === "runtime").map((entry) => entry.data);
      },
      async cards(threadId: string): Promise<Card[]> {
        const { messages } = await api<MessagePage>("GET", `/api/threads/${threadId}/messages`);
        return messages.flatMap((row) => row.card?.requestId && !row.card.answered ? [row.card] : []);
      },
    };
  } catch (error) { await close(); throw error; }
}

run("Hermes completes ten real browser phases once in one native session and one root turn", async () => {
  const f = await setup();
  try {
    const bot = await f.start();
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "180"]);
    expect(f.receipts).toEqual(operations.map((operation, index) => ({ stage: index + 1, operation, storage: f.token, cookie: `workflow=${f.token}` })));
    expect(f.attempts).toEqual(f.receipts);
    expect(f.rejected).toEqual([]);
    const trace = f.trace();
    const prompts = trace.filter((row) => row.event === "prompt");
    expect(prompts.map((row) => row.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(prompts.map((row) => row.pid)).size).toBe(1);
    expect(new Set(prompts.map((row) => row.sessionId)).size).toBe(1);
    expect([...new Set(prompts.map((row) => row.model))]).toEqual(["openai:fixture-a"]);
    expect(trace.filter((row) => row.event === "error")).toEqual([]);
    const events = await f.events(bot.threadId);
    expect(events.filter((event) => event.type === "turn.started")).toHaveLength(1);
    const completed = events.filter((event) => event.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ ok: true });
    const tools = events.filter((event) => event.type === "item.completed" && event.itemType === "tool");
    expect(tools).toHaveLength(30);
    expect(new Set(tools.map((event) => event.itemId)).size).toBe(30);
    expect(events.findIndex((event) => event.type === "turn.completed")).toBeGreaterThan(events.findLastIndex((event) => event.type === "item.completed" && event.itemType === "tool"));
    const usagePath = join(f.dataDir, "usage", `${new Date().toISOString().slice(0, 7)}.jsonl`);
    await expect.poll(() => {
      const rows: unknown[] = existsSync(usagePath) ? readFileSync(usagePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
      return rows.filter((row) => row !== null && typeof row === "object" && "botId" in row && row.botId === bot.id);
    }).toEqual([expect.objectContaining({ input: 100, output: 50 })]);
  } finally { await f.close(); }
}, 240_000);

run("Stop during a continued Hermes browser stage cannot submit or continue afterward", async () => {
  const f = await setup();
  try {
    f.stages[2].steps.splice(1, 0, step("eval", { script: "(async () => { await fetch('/hold'); document.querySelector('button').click(); return 'released'; })()" }));
    const bot = await f.start();
    await expect.poll(f.held, { timeout: 90_000 }).toBe(true);
    expect(f.receipts.map((row) => row.stage)).toEqual([1, 2]);
    await f.control(["interrupt", "--bot", bot.id, "--task", bot.threadId]);
    await expect.poll(f.holdDisconnected, { timeout: 15_000 }).toBe(true);
    f.release();
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(f.attempts.map((row) => row.stage)).toEqual([1, 2]);
    expect(f.trace().filter((row) => row.event === "prompt").map((row) => row.stage)).toEqual([0, 1, 2]);
    expect(f.trace().some((row) => row.event === "result" && row.final)).toBe(false);
    const completed = (await f.events(bot.threadId)).filter((event) => event.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ stopReason: "cancelled" });
  } finally { await f.close(); }
}, 150_000);

run.each(["direct", "room"] as const)("denying a continued %s browser write ends without a new prompt or repeated receipt", async (place) => {
  const f = await setup();
  try {
    f.stages[2].errorReply = "I'll finish the remaining workflow stages.";
    const bot = await f.start("ask", place);
    const answered = new Set<string>();
    let denied = false;
    for (let count = 0; count < 9; count++) {
      await expect.poll(async () => (await f.cards(bot.threadId)).some((card) => !answered.has(card.requestId)), { timeout: 45_000 }).toBe(true);
      const card = (await f.cards(bot.threadId)).find((candidate) => !answered.has(candidate.requestId))!;
      answered.add(card.requestId);
      const action = f.trace().findLast((row) => row.event === "tool" && row.status === "pending");
      denied = action?.stage === 2 && action.tool === "agent_browser_click";
      await f.api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.requestId, behavior: denied ? "deny" : "allow" });
      if (denied) break;
    }
    expect(denied).toBe(true);
    await f.control(bot.groupId
      ? ["wait", "--channel", bot.groupId, "--timeout", "30"]
      : ["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(f.attempts.map((row) => row.stage)).toEqual([1, 2]);
    expect(f.trace().filter((row) => row.event === "prompt").map((row) => row.stage)).toEqual([0, 1, 2]);
    expect(f.trace().filter((row) => row.event === "error")).toHaveLength(1);
    expect(f.trace().some((row) => row.event === "result" && row.final)).toBe(false);
    expect((await f.events(bot.threadId)).filter((event) => event.type === "turn.completed" && event.ok)).toEqual([]);
  } finally { await f.close(); }
}, 180_000);

run("a failed native browser tool is preserved rather than manufactured into workflow completion", async () => {
  const f = await setup();
  try {
    f.stages[2].steps[1] = step("eval", { script: "(() => { throw new Error('workflow-injected-tool-failure'); })()" });
    const bot = await f.start();
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "90"]);
    expect(f.attempts.map((row) => row.stage)).toEqual([1, 2]);
    expect(f.trace().filter((row) => row.event === "prompt").map((row) => row.stage)).toEqual([0, 1, 2]);
    expect(f.trace().filter((row) => row.event === "error")).toHaveLength(1);
    expect(f.trace().some((row) => row.event === "result" && row.final)).toBe(false);
    const completed = (await f.events(bot.threadId)).filter((event) => event.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ ok: false });
  } finally { await f.close(); }
}, 150_000);

run("a no-progress continuation ends incomplete without an outer automatic replay", async () => {
  const f = await setup();
  try {
    f.stages.splice(0, f.stages.length,
      { steps: [], reply: "I'll inspect the next workflow stage." },
      { steps: [], reply: "I'll inspect the next workflow stage." });
    const bot = await f.start();
    await f.control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    expect(f.attempts).toEqual([]);
    expect(f.trace().filter((row) => row.event === "prompt").map((row) => row.stage)).toEqual([0, 1]);
    const completed = (await f.events(bot.threadId)).filter((event) => event.type === "turn.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ ok: false, stopReason: "incomplete_action" });
  } finally { await f.close(); }
}, 90_000);
