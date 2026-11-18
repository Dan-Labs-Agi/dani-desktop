import { newId, type RequestOutcome, type RuntimeEvent } from "./contracts.ts";
import { createChatToolApproval } from "./drivers/chat-tool-approval.ts";
import { BROWSER_APPROVAL_WAIT_MS } from "./harness-budget.ts";
import { isBrowserObservation } from "../shared/browser-tool-policy.ts";

const ACTIONS: Record<string, string> = {
  agent_browser_open: "Open a page",
  agent_browser_read: "Open an address and read its page",
  agent_browser_navigate: "Navigate a page",
  agent_browser_click: "Click an element, which may submit a form or change data",
  agent_browser_fill: "Fill a field, which may send input to the site",
  agent_browser_type: "Type into a page",
  agent_browser_press: "Press a key, which may submit a form",
  agent_browser_select: "Choose an option on a page",
  agent_browser_check: "Change a checkbox",
  agent_browser_uncheck: "Change a checkbox",
  agent_browser_hover: "Move over a page element",
  agent_browser_drag: "Drag a page element",
  agent_browser_scroll: "Scroll a page",
  agent_browser_upload: "Upload a file to a site",
  agent_browser_eval: "Run JavaScript, which may send data or change the site",
  agent_browser_dialog: "Answer a page dialog",
  agent_browser_back: "Navigate back",
  agent_browser_forward: "Navigate forward",
  agent_browser_reload: "Reload a page",
  agent_browser_tab_new: "Open a browser tab",
  agent_browser_tab_switch: "Switch browser tabs",
  agent_browser_tab_close: "Close a browser tab",
  agent_browser_tabs: "Change browser tabs",
  agent_browser_close: "Close the browser",
  restart_browser: "Restart the browser",
};

export interface BrowserCall {
  botId: string;
  threadId: string;
  generation: string;
  session: string;
  provider: string;
  providerInstanceId: string;
  turnId?: string;
  method: "tools/list" | "tools/call";
  params: unknown;
  signal: AbortSignal;
  assertActive(): void;
  fullAccessNow(): boolean;
  outcomeUnknown(): boolean;
}

interface RunningCall {
  call: BrowserCall;
  controller: AbortController;
}
interface PendingApproval {
  run: RunningCall;
  answer(behavior: "allow" | "deny" | "answer"): RequestOutcome;
}
type PermissionEvent = { requestId: string } & (
  Pick<Extract<RuntimeEvent, { type: "request.opened" }>, "type" | "requestType" | "tool" | "summary" | "requiresExplicitApproval" | "allowSession"> |
  Pick<Extract<RuntimeEvent, { type: "request.resolved" }>, "type" | "behavior" | "source">
);

export class BrowserCalls {
  private readonly running = new Set<RunningCall>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly options: { publish(event: RuntimeEvent): void; timeoutMs?: number };

  constructor(options: { publish(event: RuntimeEvent): void; timeoutMs?: number }) {
    this.options = options;
  }

  private publish(run: RunningCall, event: PermissionEvent): void {
    const { call } = run;
    try {
      this.options.publish({
        eventId: newId(), createdAt: new Date().toISOString(), provider: call.provider,
        providerInstanceId: call.providerInstanceId, threadId: call.threadId, turnId: call.turnId, ...event,
      });
    } catch {
      run.controller.abort();
    }
  }

  async run(call: BrowserCall, execute: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    const run: RunningCall = { call, controller: new AbortController() };
    const signal = AbortSignal.any([call.signal, run.controller.signal]);
    this.running.add(run);
    let executing = false;
    const approval = createChatToolApproval({
      signal, timeoutMs: this.options.timeoutMs ?? BROWSER_APPROVAL_WAIT_MS,
      open: (ask) => {
        this.pending.set(ask.id, { run, answer: (behavior) => approval.answer(ask.id, behavior) });
        this.publish(run, { type: "request.opened", requestType: "permission", requestId: ask.id, tool: ask.tool,
          summary: ask.summary, requiresExplicitApproval: true, allowSession: false });
      },
      resolved: (ask, allowed, source) => {
        this.pending.delete(ask.id);
        this.publish(run, { type: "request.resolved", requestId: ask.id, behavior: allowed ? "allow" : "deny", source });
      },
      openQuestion: () => {}, resolvedQuestion: () => {},
    });
    try {
      signal.throwIfAborted();
      call.assertActive();
      const request = call.params as { name?: unknown; arguments?: { url?: unknown } } | null;
      const name = request?.name;
      const observation = isBrowserObservation(name, request?.arguments);
      if (call.method === "tools/call" && !observation && !call.fullAccessNow()) {
        const known = typeof name === "string" && Object.hasOwn(ACTIONS, name);
        const tool = known ? name : "browser_action";
        const summary = `${known ? ACTIONS[name] : "Run a browser operation"} in this bot's browser. Target and arguments: <REDACTED>.`;
        const allowed = await approval.ask(tool, summary);
        signal.throwIfAborted();
        call.assertActive();
        if (!allowed) return { isError: true, content: [{ type: "text", text: "Permission denied or expired; this browser action was not executed. Do not bypass the refusal or retry the action without a new instruction from the person." }] };
      }
      signal.throwIfAborted();
      call.assertActive();
      executing = true;
      const result = await execute(signal);
      signal.throwIfAborted();
      call.assertActive();
      return result;
    } finally {
      approval.close();
      if (!executing || signal.aborted || !call.outcomeUnknown()) this.running.delete(run);
    }
  }

  answer(threadId: string, requestId: string, behavior: "allow" | "deny" | "answer"): RequestOutcome {
    const pending = this.pending.get(requestId);
    if (!pending || pending.run.call.threadId !== threadId) return "unavailable";
    try { pending.run.call.assertActive(); }
    catch { pending.run.controller.abort(); return "unavailable"; }
    return pending.answer(behavior);
  }

  cancelTurn(threadId: string, generation: string): void {
    for (const run of this.running) {
      if (run.call.threadId === threadId && run.call.generation === generation) {
        run.controller.abort();
        this.running.delete(run);
      }
    }
  }

  cancelAll(): void {
    for (const run of this.running) run.controller.abort();
    this.running.clear();
  }
}
