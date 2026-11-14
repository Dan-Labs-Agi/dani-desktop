import { typeOneCharacterAtATime, typesInOneBurst } from "../electron/paced-typing.mjs";
import type { ChildCalls, ToolCall } from "../server/mcp-bridge.ts";
import { canVerifyEffect, observationOf, withVerifiedEffect } from "./effect.ts";
import { createComputerSession, windowKey } from "./session.ts";
import { slimResponse } from "../server/saved-steps/driver-wire.ts";
import { anchorSuggestion } from "./stages/anchor.ts";
import { loopRefusal, recordAction } from "./stages/loop-guard.ts";
import { staleRefusal } from "./stages/stale.ts";
import { verifiedScroll } from "./stages/scroll.ts";
import { verifiedTyping } from "./stages/typing.ts";
import { CLICK_TOOLS, unconfirmedClickResult } from "./unconfirmed-click.ts";

type Result = Record<string, unknown>;
type Next = () => Promise<Result>;
type Stage = (call: ToolCall, child: ChildCalls, next: Next) => Promise<Result>;
const ACTION_TOOLS = new Set(["click", "double_click", "right_click", "type_text", "set_value", "press_key", "hotkey", "scroll", "drag", "move_cursor", "launch_app", "bring_to_front"]);

function compose(call: ToolCall, child: ChildCalls, stages: readonly Stage[]): Promise<Result> {
  const run = (index: number): Promise<Result> => index === stages.length
    ? child.call(call.name, call.arguments)
    : stages[index]!(call, child, () => run(index + 1));
  return run(0);
}

function windowsTyping(platform: string): Stage {
  return (call, child, next) => platform === "win32" && typesInOneBurst(platform, child.driverVersion, call.name, call.arguments)
    ? typeOneCharacterAtATime(child.call, call.arguments as ToolCall["arguments"] & { text: string })
    : next();
}

function sentClick(platform: string): Stage {
  return async (call, _child, next) => {
    const result = await next();
    return platform === "win32" && CLICK_TOOLS.has(call.name)
      ? unconfirmedClickResult(result) ?? result
      : result;
  };
}

export interface ComputerPipelineFlags {
  stale?: boolean;
  loop?: boolean;
  typing?: boolean;
  anchor?: boolean;
  scroll?: boolean;
}

export function createComputerPipeline(platform: string, verifyEffects = false, flags: ComputerPipelineFlags = {}) {
  const session = createComputerSession();
  const stages: Stage[] = [windowsTyping(platform), sentClick(platform)];
  if (flags.typing) stages.unshift((call, child, next) => {
    const key = windowKey(call.arguments);
    return verifiedTyping(call, child, next, key ? session.snapshots.get(key) : undefined);
  });
  if (flags.scroll) stages.unshift((call, child, next) => {
    const key = windowKey(call.arguments);
    return verifiedScroll(call, child, next, key ? session.lastWindow.get(key) : undefined, (after, changed) => {
      if (key && after) session.lastWindow.set(key, after);
      if (key && changed && (flags.stale || flags.anchor)) session.staleWindows.add(key);
    });
  });
  const readBack = verifyEffects || flags.stale || flags.loop || flags.anchor;
  if (readBack) stages.unshift((call, child, next) => {
    if (!canVerifyEffect(call)) return next();
    const key = windowKey(call.arguments);
    const before = key ? session.lastWindow.get(key) ?? null : null;
    return withVerifiedEffect(call, child, {
      act: next,
      ...(typeof call.arguments.element_token === "string"
        ? { before: key ? session.lastWindow.get(key) ?? null : null }
        : key && (flags.stale || flags.loop || flags.anchor) && session.lastWindow.has(key)
          ? { before: session.lastWindow.get(key) }
          : {}),
      onObserved: (after, verdict) => {
        if (key && after) session.lastWindow.set(key, after);
        else if (key) session.lastWindow.delete(key);
        if ((flags.stale || flags.anchor) && key && verdict === "changed") session.staleWindows.add(key);
        if (flags.loop) recordAction(call, session, before, verdict);
      },
    }) as Promise<Result>;
  });
  return (call: ToolCall, child: ChildCalls): Promise<unknown> | null => {
    if ((readBack || flags.typing || flags.scroll) && call.name === "get_window_state") {
      return child.call(call.name, call.arguments).then((result) => {
        const key = windowKey(call.arguments);
        const observed = observationOf(result);
        if (key && observed) {
          session.lastWindow.set(key, observed);
          session.staleWindows.delete(key);
          const snapshot = slimResponse({ result }).structured;
          if (snapshot) session.snapshots.set(key, snapshot);
        }
        return result;
      });
    }
    if (flags.stale || flags.anchor) {
      const refusal = staleRefusal(call, session);
      if (refusal) {
        const key = windowKey(call.arguments);
        if (!flags.anchor || !key || typeof call.arguments.element_index !== "number") return Promise.resolve(refusal);
        return anchorSuggestion(call, session.snapshots.get(key), child).then((suggestion) => ({
          ...refusal,
          content: [...(refusal.content as unknown[]), { type: "text", text: suggestion }],
        }));
      }
    }
    if (flags.loop && ACTION_TOOLS.has(call.name)) {
      const refusal = loopRefusal(call, session);
      if (refusal) return Promise.resolve(refusal);
      session.actions += 1;
    }
    const typing = platform === "win32" && typesInOneBurst(platform, child.driverVersion, call.name, call.arguments);
    const clicking = platform === "win32" && CLICK_TOOLS.has(call.name);
    const checkingTyping = flags.typing && (call.name === "type_text" || call.name === "set_value");
    const checkingScroll = flags.scroll && call.name === "scroll";
    if (!typing && !clicking && !checkingTyping && !checkingScroll && !(readBack && canVerifyEffect(call)) && !(flags.loop && ACTION_TOOLS.has(call.name))) return null;
    return compose(call, child, stages);
  };
}
