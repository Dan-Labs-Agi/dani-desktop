// A plain, competent agent that works from steps. It addresses things the way a model does, by window title and element
// label from its own last read of the window, and reacts to what the checks tell it the way a model reasonably would:
// read again and retry once. It never answers a confirmation itself, and gives up on a call refused for good.
import { namesFinalAction } from "../../server/saved-steps/screen-words.ts";
import type { Intent } from "./task.ts";

export interface RpcResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;

export interface AgentRun {
  extracted: Record<string, string>;
  trace: string[];
  /** Calls the agent made, reads included. */
  calls: number;
  /** Why it stopped before the end of its steps: a call was refused for good. */
  gaveUp?: string;
  /** Why it could not carry on: its own steps name something that is not there. */
  scriptError?: string;
}

interface Element { element_index: number; element_token?: string; role: string; label?: string; value?: unknown }
interface Win { id: number; pid: number }

class GaveUp extends Error {}
class ScriptError extends Error {}

const textOf = (result: RpcResult) => (result.content ?? []).map((part) => part.text ?? "").join("\n");

type Reaction = "done" | "reread" | "again" | "stop";

/** No change in the window is ordinary for an action whose effect it cannot show, so it is acted on only when the step says
 * repeating does no harm, and never for a final action: a second send is what the note warns about. */
function react(result: RpcResult, said: string, tool: string, final: boolean, repeatable: boolean): Reaction {
  if (/call it again/i.test(said)) return "again";
  if (result.isError) return /read it again/i.test(said) ? "reread" : "stop";
  if (final) return "done";
  if ((repeatable && /shows no change/i.test(said)) || (tool === "set_value" && /differed/i.test(said))) return "reread";
  return "done";
}

export async function runScriptedAgent(intents: readonly Intent[], rpc: Rpc): Promise<AgentRun> {
  const extracted: Record<string, string> = {};
  const trace: string[] = [];
  let calls = 0;
  const known = new Map<string, Win>();
  const cache = new Map<number, Element[]>();

  const call = async (name: string, args: Record<string, unknown>): Promise<RpcResult> => {
    calls += 1;
    trace.push(name);
    return rpc(name, args);
  };

  const locate = async (title: string): Promise<Win> => {
    if (!known.has(title)) {
      const listed = await call("list_windows", {});
      const windows = (listed.structuredContent?.windows ?? []) as Array<{ window_id: number; pid: number; title: string }>;
      for (const window of windows) known.set(window.title, { id: window.window_id, pid: window.pid });
    }
    const win = known.get(title);
    if (!win) throw new ScriptError(`There is no window titled ${title}.`);
    return win;
  };

  const read = async (win: Win): Promise<{ elements: Element[]; result: RpcResult }> => {
    const result = await call("get_window_state", { pid: win.pid, window_id: win.id });
    if (result.isError) throw new GaveUp(textOf(result));
    const elements = (result.structuredContent?.elements ?? []) as Element[];
    cache.set(win.id, elements);
    return { elements, result };
  };

  const act = async (tool: string, title: string, label: string, extra: Record<string, unknown>, options: { via?: "index" | "token"; fresh?: boolean; repeatable?: boolean }) => {
    const win = await locate(title);
    let reread = options.fresh === true;
    let retried = false;
    let args: Record<string, unknown> | undefined;
    for (;;) {
      const elements = reread || !cache.has(win.id) ? (await read(win)).elements : cache.get(win.id)!;
      if (!args || reread) {
        const element = elements.find((candidate) => candidate.label === label);
        if (!element) throw new ScriptError(`There is no ${label} in ${title}.`);
        args = { pid: win.pid, window_id: win.id, ...(options.via === "token" ? { element_token: element.element_token } : { element_index: element.element_index }), ...extra };
      }
      const result = await call(tool, args);
      const said = textOf(result);
      const reaction = react(result, said, tool, namesFinalAction(label), options.repeatable === true);
      if (!retried && (reaction === "reread" || reaction === "again")) {
        retried = true;
        reread = reaction === "reread";
        continue;
      }
      if (result.isError) throw new GaveUp(said);
      return result;
    }
  };

  try {
    for (const intent of intents) {
      if (intent.do === "read") {
        const { result } = await read(await locate(intent.window));
        if (intent.record) extracted[intent.record.key] = textOf(result).startsWith(intent.record.startsWith) ? "yes" : "no";
      } else if (intent.do === "click") {
        for (let time = 0; time < (intent.repeat ?? 1); time += 1) {
          await act("click", intent.window, intent.label, {}, { ...(intent.via ? { via: intent.via } : {}), ...(intent.fresh ? { fresh: true } : {}), ...(intent.safeToRepeat ? { repeatable: true } : {}) });
        }
      } else if (intent.do === "set") {
        await act("set_value", intent.window, intent.label, { value: intent.value }, {});
      } else if (intent.do === "scroll") {
        const win = await locate(intent.window);
        for (let time = 0; time < (intent.times ?? 1); time += 1) {
          const result = await call("scroll", { pid: win.pid, window_id: win.id, direction: intent.direction, ...(intent.amount ? { amount: intent.amount } : {}) });
          if (result.isError) throw new GaveUp(textOf(result));
        }
      } else {
        const { elements } = await read(await locate(intent.window));
        const labelled = elements.filter((element) => element.label !== undefined);
        let reading: string | undefined;
        if (intent.readField !== undefined) {
          const field = elements.find((element) => element.label === intent.readField);
          if (!field) throw new ScriptError(`There is no ${intent.readField} in ${intent.window}.`);
          reading = typeof field.value === "string" ? field.value : intent.optional ? "" : undefined;
          if (reading === undefined) throw new ScriptError(`${intent.readField} in ${intent.window} shows no value.`);
        } else if (intent.last) {
          reading = labelled.at(-1)?.label;
        } else if (labelled.some((element) => element.label === intent.after)) {
          reading = labelled[labelled.findIndex((element) => element.label === intent.after) + 1]?.label;
        }
        if (reading === undefined) throw new ScriptError(`There is nothing to read ${intent.last ? "last" : `after ${intent.after}`} in ${intent.window}.`);
        extracted[intent.as] = reading;
      }
    }
  } catch (error) {
    if (error instanceof GaveUp) return { extracted, trace, calls, gaveUp: error.message };
    if (error instanceof ScriptError) return { extracted, trace, calls, scriptError: error.message };
    throw error;
  }
  return { extracted, trace, calls };
}
