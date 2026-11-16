import { afterEach, expect, it, vi } from "vitest";
import { BrowserCalls, type BrowserCall } from "./browser-calls.ts";
import type { RuntimeEvent } from "./contracts.ts";

afterEach(() => vi.useRealTimers());

function call(patch: Partial<BrowserCall> = {}): BrowserCall {
  return {
    botId: "bot-one", threadId: "thread-one", generation: "generation-one", session: "browser-one",
    provider: "claudeAgent", providerInstanceId: "claude", turnId: "turn-one", method: "tools/call",
    params: { name: "agent_browser_click", arguments: { selector: "#submit" } },
    signal: new AbortController().signal, assertActive: () => {}, fullAccessNow: () => false, outcomeUnknown: () => false, ...patch,
  };
}

it("allows only the exact pending browser action once, not another thread or a later action", async () => {
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const writes: string[] = [];
  const first = broker.run(call(), async () => { writes.push("first"); return "written"; });
  const opened = events.find((event) => event.type === "request.opened")!;
  expect(writes).toEqual([]);
  expect(broker.answer("thread-other", opened.requestId!, "allow")).toBe("unavailable");
  expect(writes).toEqual([]);
  expect(broker.answer("thread-one", opened.requestId!, "allow")).toBe("allowed-once");
  await first;
  const second = broker.run(call(), async () => { writes.push("second"); });
  const next = events.findLast((event) => event.type === "request.opened")!;
  expect(next.requestId).not.toBe(opened.requestId);
  expect(broker.answer("thread-one", opened.requestId!, "allow")).toBe("unavailable");
  expect(broker.answer("thread-one", next.requestId!, "deny")).toBe("rejected");
  await expect(second).resolves.toMatchObject({ isError: true });
  expect(writes).toEqual(["first"]);
});

it("expires a browser approval without dispatch and rejects its late answer", async () => {
  vi.useFakeTimers();
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event), timeoutMs: 100 });
  const writes: string[] = [];
  const pending = broker.run(call(), async () => { writes.push("unauthorized"); });
  const requestId = events[0].requestId!;
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toMatchObject({ isError: true });
  expect(writes).toEqual([]);
  expect(broker.answer("thread-one", requestId, "allow")).toBe("unavailable");
  expect(events.findLast((event) => event.type === "request.resolved")).toMatchObject({ behavior: "deny", source: "timeout" });
});

it("rejects approval after access changes and never dispatches stale work", async () => {
  let active = true;
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const writes: string[] = [];
  const pending = broker.run(call({ assertActive: () => { if (!active) throw new Error("profile changed"); } }), async () => { writes.push("stale"); });
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  active = false;
  expect(broker.answer("thread-one", events[0].requestId!, "allow")).toBe("unavailable");
  await rejected;
  expect(writes).toEqual([]);
});

it("revokes only the named generation while a newer browser request can still be approved", async () => {
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const writes: string[] = [];
  const old = broker.run(call(), async () => { writes.push("old"); });
  const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
  const current = broker.run(call({ generation: "generation-two" }), async () => { writes.push("current"); });
  const nextId = events.findLast((event) => event.type === "request.opened")!.requestId!;
  broker.cancelTurn("thread-one", "generation-one");
  await rejected;
  expect(broker.answer("thread-one", nextId, "allow")).toBe("allowed-once");
  await current;
  expect(writes).toEqual(["current"]);
});

it("propagates cancellation to accepted browser execution and cannot return its late success", async () => {
  const broker = new BrowserCalls({ publish: () => {} });
  const finished = Promise.withResolvers<unknown>();
  let stopped = false;
  const pending = broker.run(call({ fullAccessNow: () => true }), async (signal) => {
    signal.addEventListener("abort", () => { stopped = true; finished.resolve("late success"); }, { once: true });
    return finished.promise;
  });
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  broker.cancelTurn("thread-one", "generation-one");
  await rejected;
  expect(stopped).toBe(true);
});

it("does not publish user arguments or unknown tool names into approval events", async () => {
  const privateValue = "browser-private-password-and-path-fixture";
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const pending = broker.run(call({ params: { name: privateValue, arguments: { text: privateValue, script: privateValue, files: [privateValue] } } }), async () => { throw new Error("must not execute"); });
  expect(JSON.stringify(events)).not.toContain(privateValue);
  expect(events[0]).toMatchObject({ type: "request.opened", tool: "browser_action", summary: expect.stringContaining("<REDACTED>"), allowSession: false });
  broker.answer("thread-one", events[0].requestId!, "deny");
  await expect(pending).resolves.toMatchObject({ isError: true });
});

it("fails closed when the approval publisher is unavailable", async () => {
  const broker = new BrowserCalls({ publish: () => { throw new Error("service unavailable"); } });
  const writes: string[] = [];
  await expect(broker.run(call(), async () => { writes.push("unapproved"); })).rejects.toMatchObject({ name: "AbortError" });
  expect(writes).toEqual([]);
});

it("requires one-use approval when a read can navigate to a supplied URL", async () => {
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const navigated: string[] = [];
  const pending = broker.run(call({ params: { name: "agent_browser_read", arguments: { url: "https://fixture.test/effect" } } }), async () => { navigated.push("loaded"); });
  expect(navigated).toEqual([]);
  const opened = events.find((event) => event.type === "request.opened")!;
  expect(opened).toBeDefined();
  broker.answer("thread-one", opened.requestId!, "deny");
  await expect(pending).resolves.toMatchObject({ isError: true });
  expect(navigated).toEqual([]);
});
it.each([
  ["agent_browser_wait", { ms: 1 }],
  ["agent_browser_tabs", { action: "list" }],
  ["agent_browser_read", { selector: "main" }],
])("runs %s without approval when it only observes", async (name, args) => {
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const ran: string[] = [];
  await expect(broker.run(call({ params: { name, arguments: args } }), async () => { ran.push(name); return "seen"; })).resolves.toBe("seen");
  expect(ran).toEqual([name]);
  expect(events).toEqual([]);
});

it.each(["new", "switch", "close"] as const)("keeps agent_browser_tabs %s behind one-use approval", async (action) => {
  const events: RuntimeEvent[] = [];
  const broker = new BrowserCalls({ publish: (event) => events.push(event) });
  const ran: string[] = [];
  const pending = broker.run(call({ params: { name: "agent_browser_tabs", arguments: { action, ...(action === "new" ? { url: "https://example.test/mutate" } : { tab: "t2" }) } } }), async () => { ran.push(action); });
  expect(ran).toEqual([]);
  const opened = events.find((event) => event.type === "request.opened");
  expect(opened).toMatchObject({ tool: "agent_browser_tabs" });
  broker.answer("thread-one", opened!.requestId!, "deny");
  await expect(pending).resolves.toMatchObject({ isError: true });
  expect(ran).toEqual([]);
});

it("retains generation cancellation after a browser RPC returns an uncertain outcome", async () => {
  const broker = new BrowserCalls({ publish: () => {} });
  let unknown = false;
  let acceptedSignal: AbortSignal | undefined;
  await broker.run(call({ fullAccessNow: () => true, outcomeUnknown: () => unknown }), async (signal) => {
    acceptedSignal = signal;
    unknown = true;
    return { isError: true, content: [{ type: "text", text: "accepted action outcome unknown" }] };
  });
  expect(acceptedSignal?.aborted).toBe(false);
  broker.cancelTurn("thread-one", "generation-one");
  expect(acceptedSignal?.aborted).toBe(true);
});
