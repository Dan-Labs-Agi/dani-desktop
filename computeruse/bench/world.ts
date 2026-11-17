// The fixture world: one task run through the real computer service and pipeline, against the fake desktop, with the real
// final-action consent standing in for the server's broker and a scripted person answering its cards. Nothing here
// touches a real window, file or account. What it measures is the checks, not a model.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createFinalActionConsent, gateFinalAction } from "../../server/final-action-consent.ts";
import type { BotRecord } from "../../server/store.ts";
import { finalActionFrom } from "../../shared/computer-final-action.ts";
import { type ComputerCounters, emptyCounters } from "../counters.ts";
import { COMPUTER_EVIDENCE_PATH, parseEvidence } from "../evidence.ts";
import type { ComputerGuards } from "../guards.ts";
import { gatedLocalComputer } from "../local-computer.ts";
import { runScriptedAgent, type RpcResult } from "./agent.ts";
import type { ComputerTaskResult } from "./report.ts";
import { type ComputerSnapshot, scoreTask } from "./scorers/state.ts";
import type { BenchTask } from "./task.ts";

export interface Profile {
  name: string;
  verifyEffects: boolean;
  guards: ComputerGuards;
}

export const PROFILES: Readonly<Record<string, Profile>> = {
  baseline: { name: "baseline", verifyEffects: false, guards: {} },
  checked: {
    name: "checked", verifyEffects: true,
    guards: { stale: true, loop: true, typing: true, anchor: true, scroll: true, untrusted: true, guidance: true, pointer: true, evidence: true, risk: true },
  },
};

export interface TaskRun {
  result: ComputerTaskResult;
  trace: string[];
  gaveUp?: string;
  scriptError?: string;
}

const DRIVER = fileURLToPath(new URL("./driver.ts", import.meta.url));
const OWNER = { threadId: "bench-thread", generation: "bench-turn" };
const BOT = { id: "bench-bot", name: "Bench", color: "blue", avatarUrl: undefined, notifications: false } satisfies Pick<BotRecord, "id" | "name" | "color" | "avatarUrl" | "notifications">;
const READS = new Set(["get_window_state", "list_windows", "list_apps"]);
/** The person answers a confirmation this soon after seeing it; the broker waits longer than that for them. */
const ANSWER_AFTER_MS = 20;
const BROKER_WAIT_MS = 1_500;

function seedOf(task: BenchTask) {
  const files: Record<string, string> = {};
  const settings: Record<string, string> = {};
  const databases: Record<string, Array<Record<string, unknown>>> = {};
  for (const step of task.setup) {
    if (step.kind === "file") files[step.path] = step.content;
    else if (step.kind === "setting") settings[step.name] = step.value;
    else if (step.kind === "database") databases[step.name] = step.rows;
    else throw new Error(`The fixture world has no browser pages: ${step.page}`);
  }
  return { files, settings, databases };
}

function broker(task: BenchTask, profile: Profile) {
  const messages: Array<{ id: string; threadId: string; message: any }> = [];
  let answerFor: (requestId: string) => void = () => {};
  const store = {
    appendMessage: (threadId: string, message: any) => {
      const entry = { id: `m${messages.length + 1}`, threadId, message: { ...message } };
      messages.push(entry);
      if (message.card?.requestId) answerFor(message.card.requestId);
      return { id: entry.id };
    },
    groupByThread: () => undefined,
    messagesFor: (threadId: string) => messages.filter((entry) => entry.threadId === threadId).map((entry) => ({ id: entry.id, ...entry.message })),
    patchMessage: (threadId: string, id: string, patch: any) => {
      const entry = messages.find((candidate) => candidate.threadId === threadId && candidate.id === id);
      if (entry) Object.assign(entry.message, patch);
      return Boolean(entry);
    },
    projectBotForTask: () => null,
    setTaskActivity: () => {},
  };
  const consent = createFinalActionConsent({ store: store as never, audit: () => {}, cards: () => [] });
  answerFor = (requestId) => void setTimeout(() => consent.resolve(requestId, task.person), ANSWER_AFTER_MS).unref();
  let evidence: ComputerCounters | null = null;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const json = (body: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "POST" && url.pathname === COMPUTER_EVIDENCE_PATH) {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        evidence = parseEvidence(JSON.parse(raw)) ?? evidence;
        json({ ok: true });
      });
      return;
    }
    const call = profile.guards.risk ? finalActionFrom(url.searchParams) : undefined;
    if (!call) return json({ held: false, helpOpen: false });
    void gateFinalAction(consent, { owner: OWNER, bot: BOT, call, helpOpen: false, waitMs: BROKER_WAIT_MS })
      .then((held) => json(held ?? { held: false, helpOpen: false }));
  });
  return { server, evidence: () => evidence };
}

export async function runFixtureTask(task: BenchTask, profile: Profile): Promise<TaskRun> {
  const folder = mkdtempSync(join(tmpdir(), "computeruse-bench-"));
  const desktopFile = join(folder, "desktop.json");
  writeFileSync(desktopFile, JSON.stringify({ spec: task.desktop, seed: seedOf(task) }));
  const control = broker(task, profile);
  await new Promise<void>((resolve) => control.server.listen(0, "127.0.0.1", resolve));
  const connection = gatedLocalComputer(
    { command: process.execPath, args: ["--experimental-strip-types", DRIVER], env: { BENCH_DESKTOP: desktopFile }, platform: "linux", scope: "local-computer" },
    { url: `http://127.0.0.1:${(control.server.address() as AddressInfo).port}/control`, token: "bench-token" },
    false, profile.verifyEffects, profile.guards,
  );
  const child: ChildProcess = spawn(connection.command, connection.args, { env: { ...process.env, ...connection.env }, stdio: ["pipe", "pipe", "inherit"] });
  const replies = new Map<number, (value: RpcResult) => void>();
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const message = JSON.parse(line) as { id: number; result: RpcResult };
    replies.get(message.id)?.(message.result);
    replies.delete(message.id);
  });
  let next = 0;
  const rpc = (name: string, args: Record<string, unknown>): Promise<RpcResult> => new Promise((resolve) => {
    const id = ++next;
    replies.set(id, resolve);
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });

  const started = Date.now();
  let timedOut = false;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<null>((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(null); }, task.timeoutMs); });
    const agent = await Promise.race([runScriptedAgent(task.intents, rpc), limit]);
    clearTimeout(timer);
    const world = timedOut ? null : (await rpc("__snapshot", {})).structuredContent as Record<string, any> | undefined;
    const exited = once(child, "exit");
    child.stdin!.end();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);

    const snapshot: ComputerSnapshot = {
      files: world?.files ?? {}, databases: world?.databases ?? {}, settings: world?.settings ?? {}, api: world?.api ?? {},
      packages: new Set<string>(world?.packages ?? []), extracted: agent?.extracted ?? {},
    };
    const score = scoreTask(task.requiredEndState, task.forbiddenSideEffects, snapshot);
    const failures: ComputerTaskResult["failures"][number][] = [];
    if (timedOut) failures.push("timeout");
    if (agent?.scriptError) failures.push("script-error");
    if (!score.passed) {
      if (score.required.some((entry) => !entry.passed)) failures.push("required-state");
      if (score.forbidden.some((entry) => entry.passed)) failures.push("forbidden-side-effect");
      if (agent?.gaveUp) failures.push("driver-refusal");
    }
    const counters = control.evidence() ?? emptyCounters();
    if (!control.evidence()) counters.actions = (agent?.trace ?? []).filter((name) => !READS.has(name)).length;
    return {
      result: { id: task.id, world: "fixture", passed: !timedOut && !agent?.scriptError && score.passed, durationMs: Date.now() - started, counters, failures },
      trace: agent?.trace ?? [],
      ...(agent?.gaveUp ? { gaveUp: agent.gaveUp } : {}),
      ...(agent?.scriptError ? { scriptError: agent.scriptError } : {}),
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await new Promise<void>((resolve) => control.server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  }
}
