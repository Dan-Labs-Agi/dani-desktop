import { typeOneCharacterAtATime, typesInOneBurst } from "../electron/paced-typing.mjs";
import type { ChildCalls, ToolCall } from "../server/mcp-bridge.ts";
import { slimResponse } from "../server/saved-steps/driver-wire.ts";
import { type ComputerCounters, noteRefusal, noteVerdict, snapshotCounters } from "./counters.ts";
import { canVerifyEffect, observationOf, withVerifiedEffect } from "./effect.ts";
import { createComputerSession, windowKey, type ComputerSession } from "./session.ts";
import { anchorSuggestion } from "./stages/anchor.ts";
import { loopRefusal, recordAction } from "./stages/loop-guard.ts";
import { enablePointer } from "./stages/pointer.ts";
import { verifiedScroll } from "./stages/scroll.ts";
import { staleRefusal } from "./stages/stale.ts";
import { verifiedTyping } from "./stages/typing.ts";
import { CLICK_TOOLS, unconfirmedClickResult } from "./unconfirmed-click.ts";

type Result = Record<string, unknown>;
type Next = () => Promise<Result>;
interface Stage { run: (next: Next) => Promise<Result> }

const ACTION_TOOLS = new Set(["click", "double_click", "right_click", "type_text", "set_value", "press_key", "hotkey", "scroll", "drag", "move_cursor", "launch_app", "bring_to_front"]);

export interface ComputerPipelineFlags {
  stale?: boolean;
  loop?: boolean;
  typing?: boolean;
  anchor?: boolean;
  scroll?: boolean;
  pointer?: boolean;
  evidence?: boolean;
}

export interface ComputerPipeline {
  (call: ToolCall, child: ChildCalls): Promise<unknown> | null;
  /** What this session has done so far, as a copy. */
  counters(): ComputerCounters;
}

function compose(call: ToolCall, child: ChildCalls, stages: readonly Stage[]): Promise<Result> {
  const run = (index: number): Promise<Result> => index === stages.length
    ? child.call(call.name, call.arguments)
    : stages[index]!.run(() => run(index + 1));
  return run(0);
}

/** The reads a stage makes for itself, counted and timed: that cost is what turning a check on adds to every action. */
function measured(child: ChildCalls, session: ComputerSession): ChildCalls {
  return {
    get driverVersion() { return child.driverVersion; },
    async call(name, args) {
      if (name !== "get_window_state") return child.call(name, args);
      const started = Date.now();
      try {
        return await child.call(name, args);
      } finally {
        session.counters.readBacks += 1;
        session.counters.addedMs += Date.now() - started;
      }
    },
  };
}

export function createComputerPipeline(platform: string, verifyEffects = false, flags: ComputerPipelineFlags = {}): ComputerPipeline {
  const session = createComputerSession();
  const windows = platform === "win32";
  const guarding = Boolean(flags.stale || flags.anchor);
  const readBack = verifyEffects || guarding || Boolean(flags.loop);
  const recording = readBack || Boolean(flags.typing || flags.scroll);
  const counting = Boolean(flags.loop || flags.evidence);

  const observed = (call: ToolCall, child: ChildCalls): Promise<Result> =>
    child.call(call.name, call.arguments).then((result) => {
      const key = windowKey(call.arguments);
      const now = observationOf(result);
      if (key && now) {
        session.lastWindow.set(key, now);
        session.staleWindows.delete(key);
        const snapshot = slimResponse({ result }).structured;
        if (snapshot) session.snapshots.set(key, snapshot);
      }
      return result;
    });

  const refusal = (call: ToolCall, child: ChildCalls): Promise<Result> | null => {
    if (guarding) {
      const stale = staleRefusal(call, session);
      if (stale) {
        noteRefusal(session.counters, "stale");
        const key = windowKey(call.arguments);
        if (!flags.anchor || !key || typeof call.arguments.element_index !== "number") return Promise.resolve(stale);
        return anchorSuggestion(call, session.snapshots.get(key), child).then((suggestion) => ({
          ...stale,
          content: [...(stale.content as unknown[]), { type: "text", text: suggestion }],
        }));
      }
    }
    if (flags.loop && ACTION_TOOLS.has(call.name)) {
      const loop = loopRefusal(call, session);
      if (loop) {
        noteRefusal(session.counters, "loop");
        return Promise.resolve(loop);
      }
    }
    return null;
  };

  const stagesFor = (call: ToolCall, child: ChildCalls): Stage[] => {
    const stages: Stage[] = [];
    if (flags.pointer && ACTION_TOOLS.has(call.name) && !session.pointerReady) {
      stages.push({ run: async (next) => {
        session.pointerReady = true;
        await enablePointer(child);
        return next();
      } });
    }
    if (readBack && canVerifyEffect(call)) {
      const key = windowKey(call.arguments);
      const cached = key ? session.lastWindow.get(key) : undefined;
      // An element token dies with the snapshot that issued it, so such a call is never preceded by a read of its own.
      const reuse = typeof call.arguments.element_token === "string" || ((guarding || flags.loop) && cached !== undefined);
      stages.push({ run: (next) => {
        const before = cached ?? null;
        return withVerifiedEffect(call, child, {
          act: next,
          ...(reuse ? { before } : {}),
          onObserved: (after, verdict) => {
            if (key && after) session.lastWindow.set(key, after);
            else if (key) session.lastWindow.delete(key);
            if (guarding && key && verdict === "changed") session.staleWindows.add(key);
            noteVerdict(session.counters, verdict);
            if (flags.loop) recordAction(call, session, before, verdict);
          },
        }) as Promise<Result>;
      } });
    }
    if (flags.scroll && call.name === "scroll") {
      const key = windowKey(call.arguments);
      stages.push({ run: (next) => verifiedScroll(call, child, next, key ? session.lastWindow.get(key) : undefined, (after, changed) => {
        if (key && after) session.lastWindow.set(key, after);
        if (key && changed && guarding) session.staleWindows.add(key);
      }) });
    }
    if (flags.typing && (call.name === "type_text" || call.name === "set_value")) {
      const key = windowKey(call.arguments);
      stages.push({ run: (next) => verifiedTyping(call, child, next, key ? session.snapshots.get(key) : undefined) });
    }
    if (windows && typesInOneBurst(platform, child.driverVersion, call.name, call.arguments)) {
      stages.push({ run: () => typeOneCharacterAtATime(child.call, call.arguments as ToolCall["arguments"] & { text: string }) });
    }
    if (windows && CLICK_TOOLS.has(call.name)) {
      stages.push({ run: async (next) => {
        const result = await next();
        return unconfirmedClickResult(result) ?? result;
      } });
    }
    return stages;
  };

  const relay = (call: ToolCall, child: ChildCalls): Promise<unknown> | null => {
    if (recording && call.name === "get_window_state") return observed(call, child);
    const refused = refusal(call, child);
    if (refused) return refused;
    const acting = ACTION_TOOLS.has(call.name);
    if (counting && acting) {
      session.actions += 1;
      session.counters.actions += 1;
    }
    const counted = measured(child, session);
    const stages = stagesFor(call, counted);
    return stages.length > 0 || (counting && acting) ? compose(call, counted, stages) : null;
  };

  return Object.assign(relay, { counters: () => snapshotCounters(session.counters) });
}
