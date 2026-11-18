import type { ToolCall } from "../server/mcp-bridge.ts";
import type { BatchSpec } from "../server/mcp-bridge-batch.ts";

type Rec = Record<string, unknown>;

export const BATCH_LIMIT = 6;
/** What a batch may hold: the actions on a window, and the reads that show its result. Never another batch, a launch or a drag. */
export const BATCH_TOOLS = ["click", "double_click", "right_click", "type_text", "set_value", "press_key", "hotkey", "scroll", "get_window_state", "read_window"] as const;
/** Each call's own words are shown, but a long read is cut: a batch is for steps, not for reading. */
const SHOWN_CHARS = 3_000;

export const BATCH_TOOL = {
  name: "computer_batch",
  description: `Make up to ${BATCH_LIMIT} calls on windows, one after another, in one step. Each call is checked and confirmed exactly as if you made it alone, ` +
    "and a final action still asks the person first. The batch stops at the first call that is refused, fails, leaves the window unchanged, " +
    "has an effect the window does not show, or types text the field does not hold, and says where. Pictures are left out; end with read_window to see the result. " +
    "An action changes the window, so an element index or token from before it is out of date for the next call: make an action on an element on its own, " +
    "and use a batch for key presses, typing into the focused field, scrolling, and a closing read_window.",
  inputSchema: {
    type: "object",
    properties: {
      calls: {
        type: "array", minItems: 1, maxItems: BATCH_LIMIT,
        items: {
          type: "object",
          properties: { name: { type: "string", enum: [...BATCH_TOOLS] }, arguments: { type: "object" } },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    required: ["calls"],
    additionalProperties: false,
  },
};

const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const texts = (result: Rec) => (Array.isArray(result.content) ? result.content : []).flatMap((part) =>
  isRec(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []);

function plan(args: Rec): { calls: ToolCall[] } | { error: string } {
  const calls = args.calls;
  if (!Array.isArray(calls) || calls.length === 0) return { error: "Give `calls`: a list of one to " + BATCH_LIMIT + " calls. Nothing was run." };
  if (calls.length > BATCH_LIMIT) return { error: `A batch holds at most ${BATCH_LIMIT} calls and this one has ${calls.length}. Nothing was run.` };
  const planned: ToolCall[] = [];
  for (const [index, call] of calls.entries()) {
    if (!isRec(call) || typeof call.name !== "string") return { error: `Call ${index + 1} has no name. Nothing was run.` };
    if (!(BATCH_TOOLS as readonly string[]).includes(call.name)) return { error: `Call ${index + 1}, ${call.name}, cannot be in a batch; make it on its own. Nothing was run.` };
    if (call.arguments !== undefined && !isRec(call.arguments)) return { error: `Call ${index + 1} has arguments that are not an object. Nothing was run.` };
    planned.push({ name: call.name, arguments: isRec(call.arguments) ? call.arguments : {} });
  }
  return { calls: planned };
}

/** What a call's own answer says went wrong, from the fields the checks put there; null when nothing did. */
function stopAfter(_call: ToolCall, result: Rec): string | null {
  if (result.isError === true) return "it was refused or failed";
  const structured = isRec(result.structuredContent) ? result.structuredContent : {};
  const receipt = isRec(structured.actionReceipt) ? structured.actionReceipt : {};
  if (receipt.outcome === "blocked" || receipt.outcome === "error") return "it was refused or failed";
  if (receipt.observation === "unchanged") return "the window did not change";
  if (receipt.observation === "unobserved") return "its effect is not one the window shows";
  if (structured.typing_verification === "differs") return "the field does not hold what was typed";
  if (structured.typing_verification === "unreadable") return "the field could not be read back";
  return null;
}

function answer(done: ReadonlyArray<{ call: ToolCall; result: Rec }>, planned: number, stopped: string | null): Rec {
  const lines = done.flatMap(({ call, result }, index) => {
    const said = texts(result).join("\n");
    return [`${index + 1}. ${call.name}${result.isError === true ? " (failed)" : ""}`, said.length > SHOWN_CHARS ? `${said.slice(0, SHOWN_CHARS)}\n[shortened]` : said].filter(Boolean);
  });
  const summary = stopped === null ? `Ran all ${planned} calls.` : `Ran ${done.length} of ${planned} calls and stopped: ${stopped}. The rest were not made.`;
  const failed = done.some(({ result }) => result.isError === true);
  return {
    ...(failed ? { isError: true } : {}),
    content: [{ type: "text", text: [...lines, summary].join("\n") }],
    structuredContent: { planned, ran: done.length, stopped, calls: done.map(({ call, result }) => ({ name: call.name, ok: result.isError !== true })) },
  };
}

export const COMPUTER_BATCH: BatchSpec = { name: BATCH_TOOL.name, plan, stopAfter, answer };
