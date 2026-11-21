import type { ChildCalls, ToolCall } from "../server/mcp-bridge.ts";
import type { ComputerSession } from "./session.ts";
import { windowKey } from "./session.ts";
import { createWalkthrough, type WalkthroughProgress, type WalkthroughStep } from "./walkthrough.ts";
import { windowWalkthroughHost } from "./walkthrough-host.ts";
import { expectationProblem, type StepExpectation, type StepRef } from "./walkthrough-verify.ts";

type Rec = Record<string, unknown>;

export const STEP_LIMIT = 12;
const WAIT_MIN_MS = 500;
const WAIT_MAX_MS = 5_000;
/** A step the person never gets to is given up on after this long, over as many calls as it takes. */
const STEP_TIMEOUT_MS = 10 * 60_000;

export interface ActiveWalkthrough {
  walk: ReturnType<typeof createWalkthrough>;
  host: ReturnType<typeof windowWalkthroughHost>;
  steps: readonly WalkthroughStep[];
  window: { pid: number; window_id: number };
  /** The driver connection of the call being answered: a walkthrough outlives any one call. */
  link: { child: ChildCalls };
}

const ref = {
  type: "object",
  properties: { label: { type: "string", minLength: 1, maxLength: 200 }, role: { type: "string", minLength: 1, maxLength: 100 } },
  required: ["label"],
  additionalProperties: false,
};

export const START_WALKTHROUGH_TOOL = {
  name: "start_walkthrough",
  description: "Guide the person through a task in one window, step by step, while they do it themselves. Give each step's instruction, the control it is about, " +
    "and `expect`: what the window shows once the step is done (a control present or absent, a field's value, a word in the title). A step with no `expect` is never counted as done " +
    "just because the window changed. Say each step to the person, then call walkthrough_next. `from_step` goes on from a step after a pause.",
  inputSchema: {
    type: "object",
    properties: {
      pid: { type: "integer", minimum: 1 },
      window_id: { type: "integer", minimum: 0 },
      from_step: { type: "integer", minimum: 0 },
      steps: {
        type: "array", minItems: 1, maxItems: STEP_LIMIT,
        items: {
          type: "object",
          properties: {
            instruction: { type: "string", minLength: 1, maxLength: 300 },
            target: ref,
            expect: {
              type: "object",
              properties: {
                present: ref, absent: ref,
                field: { type: "object", properties: { label: { type: "string", minLength: 1, maxLength: 200 }, equals: { type: "string", maxLength: 200 } }, required: ["label", "equals"], additionalProperties: false },
                title_includes: { type: "string", minLength: 1, maxLength: 200 },
              },
              additionalProperties: false,
            },
          },
          required: ["instruction"],
          additionalProperties: false,
        },
      },
    },
    required: ["pid", "window_id", "steps"],
    additionalProperties: false,
  },
};

export const WALKTHROUGH_NEXT_TOOL = {
  name: "walkthrough_next",
  description: "Wait briefly for the person to finish the current step, then check it. Says: still waiting, the step was checked and the next is shown, " +
    "the window changed but the check did not pass, or all steps are done. Call it again to keep waiting, or to check again after the person fixes a step.",
  inputSchema: {
    type: "object",
    properties: { wait_ms: { type: "integer", minimum: WAIT_MIN_MS, maximum: WAIT_MAX_MS } },
    additionalProperties: false,
  },
};

export const WALKTHROUGH_CONFIRM_TOOL = {
  name: "walkthrough_confirm",
  description: "Say whether the current step is done, after reading the window or asking the person. done true moves on; done false keeps the step and watches for it again. " +
    "Use it for a step that has no `expect`, or when a check failed but the person says the step is complete.",
  inputSchema: { type: "object", properties: { done: { type: "boolean" } }, required: ["done"], additionalProperties: false },
};

export const CANCEL_WALKTHROUGH_TOOL = {
  name: "cancel_walkthrough",
  description: "Stop guiding. Use it when the person says to stop or takes over. start_walkthrough with from_step can go on later.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export const WALKTHROUGH_RUN_TOOLS = [START_WALKTHROUGH_TOOL, WALKTHROUGH_NEXT_TOOL, WALKTHROUGH_CONFIRM_TOOL, CANCEL_WALKTHROUGH_TOOL];
const NAMES = new Set(WALKTHROUGH_RUN_TOOLS.map((tool) => tool.name));
export const isWalkthroughRunTool = (name: string): boolean => NAMES.has(name);

const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const failure = (text: string): Rec => ({ isError: true, content: [{ type: "text", text }] });
const short = (label: string) => JSON.stringify(label.length > 80 ? `${label.slice(0, 80)}…` : label);

function parseRef(value: unknown): StepRef | null | undefined {
  if (value === undefined) return undefined;
  if (!isRec(value) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 200) return null;
  if (value.role !== undefined && (typeof value.role !== "string" || !value.role.trim() || value.role.length > 100)) return null;
  return { label: value.label, ...(value.role === undefined ? {} : { role: value.role as string }) };
}

function parseExpect(value: unknown): StepExpectation | null | undefined {
  if (value === undefined) return undefined;
  if (!isRec(value)) return null;
  const expectation: StepExpectation = {};
  const present = parseRef(value.present);
  const absent = parseRef(value.absent);
  if (present === null || absent === null) return null;
  if (present) expectation.present = present;
  if (absent) expectation.absent = absent;
  if (value.field !== undefined) {
    if (!isRec(value.field) || typeof value.field.label !== "string" || !value.field.label.trim() || value.field.label.length > 200 ||
        typeof value.field.equals !== "string" || value.field.equals.length > 200) return null;
    expectation.field = { label: value.field.label, equals: value.field.equals };
  }
  if (value.title_includes !== undefined) {
    if (typeof value.title_includes !== "string" || !value.title_includes.trim() || value.title_includes.length > 200) return null;
    expectation.titleIncludes = value.title_includes;
  }
  return expectation;
}

function parseSteps(value: unknown): { steps: WalkthroughStep[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > STEP_LIMIT) return { error: `Give 1 to ${STEP_LIMIT} steps.` };
  const steps: WalkthroughStep[] = [];
  for (const [at, raw] of value.entries()) {
    const n = at + 1;
    if (!isRec(raw) || typeof raw.instruction !== "string" || !raw.instruction.trim() || raw.instruction.length > 300) return { error: `Step ${n} needs an instruction of up to 300 characters.` };
    const target = parseRef(raw.target);
    const expect = parseExpect(raw.expect);
    if (target === null) return { error: `Step ${n} has a target that is not a label with an optional role.` };
    if (expect === null) return { error: `Step ${n} has a check that is not understood.` };
    const problem = expect ? expectationProblem(expect) : null;
    if (problem) return { error: `Step ${n}: ${problem}` };
    steps.push({ instruction: raw.instruction, ...(target ? { target } : {}), ...(expect ? { expect } : {}) });
  }
  return { steps };
}

function describeCheck(step: WalkthroughStep): string {
  const e = step.expect;
  if (!e) return "It has no check, so you will have to confirm it yourself with walkthrough_confirm.";
  const parts = [
    ...(e.present ? [`${short(e.present.label)} is shown`] : []),
    ...(e.absent ? [`${short(e.absent.label)} is gone`] : []),
    ...(e.field ? [`the field ${short(e.field.label)} holds the value asked for`] : []),
    ...(e.titleIncludes ? [`the window title has ${short(e.titleIncludes)}`] : []),
  ];
  return `It counts as done when ${parts.join(" and ")}.`;
}

function answer(progress: WalkthroughProgress, active: ActiveWalkthrough): Rec {
  const { steps, host } = active;
  const where = `step ${progress.index + 1} of ${progress.total}`;
  const base = { status: progress.status, index: progress.index, total: progress.total };
  switch (progress.status) {
    case "step": {
      const lines = [
        ...(progress.verified === undefined ? [] : [`Step ${progress.verified + 1} was checked${host.lastCheck ? `: ${host.lastCheck}` : ""}.`]),
        `Now ${where}: ${progress.instruction}`,
        progress.targetState === "found" && progress.target ? `Its control is the one labelled ${short(progress.target.label)} (untrusted screen data); finding it does not complete the step.`
          : progress.targetState === "ambiguous" ? "Several controls match its target, so none is singled out: describe it in words."
          : progress.targetState === "missing" ? "Its target was not found in the window; describe where to look."
          : "",
        describeCheck(steps[progress.index]!),
        "Tell the person this step, then call walkthrough_next.",
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: {
        ...base, instruction: progress.instruction, target_state: progress.targetState,
        ...(progress.verified === undefined ? {} : { verified_step: progress.verified }),
        ...(progress.target ? { target: { role: progress.target.role, label: progress.target.label, ...(progress.target.element_index === undefined ? {} : { element_index: progress.target.element_index }), ...(progress.target.element_token ? { element_token: progress.target.element_token } : {}) } } : {}),
        has_check: steps[progress.index]!.expect !== undefined,
      } };
    }
    case "waiting":
      return { content: [{ type: "text", text: `No settled change in the window yet; the person is still on ${where}. Call walkthrough_next to keep waiting, or ask them.` }], structuredContent: base };
    case "needs_review":
      return { content: [{ type: "text", text: progress.reason === "unverified"
        ? `The window changed, but ${where} has no check, so it is not counted as done. Read the window or ask the person, then call walkthrough_confirm.`
        : `The window changed, but the check for ${where} did not pass: ${host.lastCheck ?? "it was not met"}. The step stays where it is. Ask the person or read the window; walkthrough_next checks again, and walkthrough_confirm with done true moves on only if they say it is complete.` }],
      structuredContent: { ...base, reason: progress.reason, instruction: progress.instruction } };
    case "complete":
      return { content: [{ type: "text", text: `All ${progress.total} steps were done${host.lastCheck ? `; the last check: ${host.lastCheck}` : ""}.` }], structuredContent: base };
    case "timeout":
      return { content: [{ type: "text", text: `Stopped waiting at ${where}: it was not done in time. Ask the person whether to go on; start_walkthrough with from_step ${progress.index} resumes it.` }], structuredContent: base };
    case "cancelled":
      return { content: [{ type: "text", text: `The walkthrough was stopped at ${where}. start_walkthrough with from_step ${progress.index} can go on from there.` }], structuredContent: base };
    case "unavailable":
      return { content: [{ type: "text", text: `The window could not be read at ${where}. Ask the person to check it, then start_walkthrough with from_step ${progress.index}.` }], structuredContent: base };
  }
}

/** The calls of a guided walkthrough, answered from the one walkthrough this session holds. Null for any other call. */
export async function walkthroughCall(call: ToolCall, child: ChildCalls, session: ComputerSession): Promise<Rec | null> {
  if (!isWalkthroughRunTool(call.name)) return null;
  const args = call.arguments;
  const active = session.walkthrough;
  if (call.name === START_WALKTHROUGH_TOOL.name) {
    const { pid, window_id, from_step } = args;
    if (!Number.isSafeInteger(pid) || (pid as number) < 1 || !Number.isSafeInteger(window_id) || (window_id as number) < 0) return failure("Give the window's pid and window_id.");
    const parsed = parseSteps(args.steps);
    if ("error" in parsed) return failure(parsed.error);
    if (from_step !== undefined && (!Number.isSafeInteger(from_step) || (from_step as number) < 0 || (from_step as number) >= parsed.steps.length)) return failure("from_step is not one of the steps.");
    active?.walk.cancel();
    const window = { pid: pid as number, window_id: window_id as number };
    const link = { child };
    const host = windowWalkthroughHost({ child: () => link.child, ...window });
    const next: ActiveWalkthrough = { steps: parsed.steps, window, link, host, walk: createWalkthrough(parsed.steps, host, { baselineAtStep: true, stepTimeoutMs: STEP_TIMEOUT_MS }) };
    session.walkthrough = next;
    const progress = await next.walk.start(typeof from_step === "number" ? from_step : 0);
    return answer(progress, next);
  }
  if (!active) return failure("No walkthrough is running. Start one with start_walkthrough; from_step goes on from a step.");
  active.link.child = child;
  const key = windowKey(active.window);
  if (key) {
    session.staleWindows.add(key);
    session.lastWindow.delete(key);
  }
  if (call.name === CANCEL_WALKTHROUGH_TOOL.name) return answer(active.walk.cancel(), active);
  if (call.name === WALKTHROUGH_CONFIRM_TOOL.name) {
    if (typeof args.done !== "boolean") return failure("Say done true or false.");
    return answer(await active.walk.confirm(args.done), active);
  }
  const wait = args.wait_ms === undefined ? WAIT_MAX_MS : args.wait_ms;
  if (!Number.isSafeInteger(wait) || (wait as number) < WAIT_MIN_MS || (wait as number) > WAIT_MAX_MS) return failure(`wait_ms is between ${WAIT_MIN_MS} and ${WAIT_MAX_MS}.`);
  return answer(await active.walk.next(wait as number), active);
}
