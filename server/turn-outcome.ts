import { errorTranscript } from "../shared/client-cancel.ts";
import { isOutboundTool } from "../shared/outbound.ts";
import type { RuntimeEvent } from "./contracts.ts";
import { buildTurnDigest, digestTools } from "./digest.ts";
import { stopCause } from "./drivers/engine-errors.ts";
import type { BlockedTurn, TurnEvidence } from "./runtime/types.ts";
import type { Message } from "./store.ts";

const REASON_CHARS = 600;

type RuntimeError = RuntimeEvent & { type: "runtime.error" };

export interface TurnStop {
  turnId?: string;
  stopReason?: string;
  cause?: string;
  error?: string;
  flags?: Pick<RuntimeError, "setup" | "stalled" | "trialCredit" | "limitResetsAt" | "limit" | "recovery"> & { toolError?: true; permissionDenied?: true };
  handoffPath?: string;
  browserWait?: string;
  unknownEffect?: true;
  browserWork?: true;
  workRemaining?: true;
  cancelled?: true;
}

export class TurnStops {
  readonly #byThread = new Map<string, TurnStop>();

  note(event: RuntimeEvent): void {
    if (event.type === "turn.started") {
      this.#byThread.delete(event.threadId);
      return;
    }
    if (event.type === "turn.completed") {
      const stop = this.#turn(event.threadId, event.turnId);
      if (!event.ok && event.stopReason) stop.stopReason = event.stopReason;
      if (event.stopReason === "cancelled") stop.cancelled = true;
      return;
    }
    if (event.type === "turn.work-status") {
      const stop = this.#turn(event.threadId, event.turnId);
      if (event.status === "remaining") stop.workRemaining = true;
      else delete stop.workRemaining;
      return;
    }
    if ((event.type === "request.resolved" && event.behavior === "deny") ||
        (event.type === "item.completed" && event.itemType === "tool" && event.ok === false)) {
      const stop = this.#turn(event.threadId, event.turnId);
      stop.flags = { ...stop.flags, toolError: true, ...(event.type === "request.resolved" ? { permissionDenied: true as const } : {}) };
      return;
    }
    const error = event.type === "runtime.error" ? event.message
      : event.type === "item.completed" && event.itemType === "assistant_text" && event.synthetic ? event.text : undefined;
    if (event.type !== "cap.exhausted" && (error === undefined || errorTranscript(error).kind !== "error")) return;
    const stop = this.#turn(event.threadId, event.turnId);
    if (event.type === "cap.exhausted") stop.handoffPath = event.handoffPath;
    else stop.error = error;
    if (event.type === "runtime.error") {
      const { setup, stalled, trialCredit, limitResetsAt, limit } = event;
      const recovery = stop.flags?.recovery === "blocked" ? "blocked" : event.recovery;
      if (setup || stalled || trialCredit || limitResetsAt || limit || recovery) stop.flags = { ...stop.flags, setup, stalled, trialCredit, limitResetsAt, limit, recovery };
    }
  }

  mayContinue(threadId: string, turnId?: string, recovery?: "observation"): boolean {
    const stop = this.read(threadId, turnId);
    return !stop?.cancelled && !stop?.flags?.permissionDenied && !stop?.unknownEffect && !stop?.browserWait
      && stop?.flags?.recovery !== "blocked" && (!stop?.flags?.toolError || recovery === "observation");
  }

  usedBrowser(threadId: string, turnId: string): void {
    this.#turn(threadId, turnId).browserWork = true;
  }

  waitForBrowser(threadId: string, turnId: string, session: string): void {
    this.#turn(threadId, turnId).browserWait = session;
  }

  browserContinued(threadId: string, turnId: string, session: string): void {
    const stop = this.#byThread.get(threadId);
    if (stop?.turnId === turnId && stop.browserWait === session) delete stop.browserWait;
  }

  unknownBrowserEffect(threadId: string, turnId: string): void {
    const stop = this.#turn(threadId, turnId);
    stop.unknownEffect = true;
    stop.flags = { ...stop.flags, toolError: true, recovery: "blocked" };
  }

  stopping(threadId: string, turnId: string | undefined, cause: string): void {
    this.#turn(threadId, turnId).cause = cause;
  }

  #turn(threadId: string, turnId: string | undefined): TurnStop {
    const held = this.#byThread.get(threadId);
    const stop: TurnStop = held && held.turnId === turnId ? held : { turnId };
    this.#byThread.set(threadId, stop);
    return stop;
  }

  read(threadId: string, turnId?: string): TurnStop | undefined {
    const stop = this.#byThread.get(threadId);
    return stop && (!turnId || !stop.turnId || stop.turnId === turnId) ? stop : undefined;
  }

  /** The turn's own last error, else the provider's stop reason in words; undefined for a turn that did not fail. */
  failureCause(event: { threadId: string; turnId?: string; ok: boolean; stopReason?: string | null }): string | undefined {
    if (event.ok) return undefined;
    return this.read(event.threadId, event.turnId)?.error ?? stopCause(event.stopReason);
  }

  forget(threadId: string): void {
    this.#byThread.delete(threadId);
  }
}

export function blockingTurnStop(stop: TurnStop | undefined): BlockedTurn | undefined {
  if (stop?.flags?.permissionDenied) return { outcome: "denied", reason: "The person denied permission. This goal cannot authorize a retry or substitute action." };
  if (stop?.unknownEffect || stop?.flags?.recovery === "blocked") return { outcome: "provider_error", reason: stop.error ?? "An accepted action has an uncertain result. Inspect or resolve that result before resuming." };
  if (stop?.cancelled) return { outcome: "interrupted", reason: "The native turn was cancelled before completion. Inspect any in-flight effects before resuming; the cancelled step will not be retried automatically." };
  if (stop?.flags?.setup || stop?.flags?.trialCredit || stop?.flags?.limit || stop?.flags?.limitResetsAt) {
    return { outcome: "provider_error", reason: stop.error ?? "The engine requires authentication, setup, or available quota before this task can continue." };
  }
  return undefined;
}

/** Cause first (a chip shows only the start), then the last message quoted as data, so a teammate's words never pass for the harness's. */
export function stoppedTurnOutcome(input: {
  reason: string;
  activities: readonly Message[];
  turnId?: string;
  said?: string;
}): string {
  const parts = [sentence(clip(input.reason, REASON_CHARS))];
  if (input.turnId) {
    const digest = buildTurnDigest({
      turnId: input.turnId, botId: "", threadId: "", at: 0, durationMs: 0,
      activities: input.activities, memory: [], reply: "", hookCoverage: "preview",
    });
    parts.push(digest.toolCalls
      ? `Before it stopped it made ${digest.toolCalls} tool call${digest.toolCalls === 1 ? "" : "s"}: ${digestTools(digest)}.`
      : "No tool calls were seen before it stopped.");
  }
  const said = input.said?.trim();
  return said ? `${parts.join(" ")}\nIts last message, quoted: ${JSON.stringify(said)}` : parts.join(" ");
}

const SHELL_TOOL = /^(?:mcp__[\w-]+?__)?(?:bash|shell|exec|run_command|execute_command|run_shell_command|run_terminal_cmd|terminal|COMPOSIO_REMOTE_BASH_TOOL)$/i;
const GIT_OUTWARD = /\bgit\s+(commit|push)\b/g;
const MONEY_OUTWARD = /\b(pay|payment|charge|refund|transfer)\b/gi;
const ERROR_CHARS = 200;
const ERRORS_KEPT = 3;

const toolRows = (rows: readonly Message[]) =>
  rows.filter((row) => row.role === "bot" && row.kind === "activity" && row.tool !== undefined);

/** The one outward-action classifier: the restart policy uses it so a cut turn that already acted never reruns. */
export function outwardActions(rows: readonly Message[]): string[] {
  const labels: string[] = [];
  const add = (label: string) => { if (!labels.includes(label)) labels.push(label); };
  for (const row of toolRows(rows)) {
    const tool = row.tool!;
    if (tool.ok === false) continue;
    if (isOutboundTool(tool.name)) { add(tool.name); continue; }
    if (!SHELL_TOOL.test(tool.name)) continue;
    const command = [tool.input, tool.summary].filter((text): text is string => typeof text === "string").join("\n");
    for (const git of command.matchAll(GIT_OUTWARD)) add(`git ${git[1]}`);
    for (const money of command.matchAll(MONEY_OUTWARD)) add(money[1]!.toLowerCase());
  }
  return labels;
}

export function turnEvidence(rows: readonly Message[]): TurnEvidence {
  const tools = toolRows(rows);
  const errors = tools.filter((row) => row.tool!.ok === false).map((row) => {
    const tool = row.tool!;
    const output = tool.itemId && typeof tool.output === "string" ? tool.output.split("\n").find((line) => line.trim()) : undefined;
    return clip(output ? `${tool.name}: ${output}` : tool.name, ERROR_CHARS);
  }).slice(-ERRORS_KEPT);
  const okToolCalls = tools.filter((row) => row.tool!.ok !== false && row.tool!.itemId !== undefined).length;
  const outward = outwardActions(rows);
  return { toolCalls: tools.filter((row) => row.tool!.itemId !== undefined).length, okToolCalls, errors, ...(outward.length ? { outward } : {}) };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function sentence(text: string): string {
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?…"]$/.test(capital) ? capital : `${capital}.`;
}
