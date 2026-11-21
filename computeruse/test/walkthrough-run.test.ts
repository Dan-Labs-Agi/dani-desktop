import { describe, expect, it } from "vitest";
import { localComputerResultLine } from "../guidance.ts";
import { createComputerPipeline } from "../pipeline.ts";
import { createComputerSession } from "../session.ts";
import { START_WALKTHROUGH_TOOL, WALKTHROUGH_RUN_TOOLS, walkthroughCall } from "../walkthrough-run.ts";

/** A window the test changes, and the calls it was read with. */
function fixture() {
  const state = { title: "Settings", elements: [{ element_index: 1, element_token: "s1:1", role: "Button", label: "Dark" }, { element_index: 2, role: "Edit", label: "Name", value: "" }] as Array<Record<string, unknown>>, reads: 0 };
  const child = {
    driverVersion: undefined,
    call: async () => {
      state.reads += 1;
      return { structuredContent: { app_name: "Settings", window_title: state.title, elements_complete: true, elements: state.elements } };
    },
  };
  const session = createComputerSession();
  const call = (name: string, args: Record<string, unknown> = {}) => walkthroughCall({ name, arguments: args }, child, session) as Promise<Record<string, any>>;
  const text = (result: Record<string, any>) => (result.content as Array<{ text: string }>).map((part) => part.text).join(" ");
  return { state, session, call, text };
}

const window = { pid: 4, window_id: 9 };
const twoSteps = [
  { instruction: "Open the theme list", target: { label: "Dark" }, expect: { title_includes: "Themes" } },
  { instruction: "Type your name", expect: { field: { label: "Name", equals: "Ann" } } },
];

describe("guided-task calls", () => {
  it("lists the four tools with the guidance switch, and leaves them out without it", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "get_window_state", description: "Read" }] } });
    const names = JSON.parse(localComputerResultLine(line, false, true)).result.tools.map((tool: { name: string }) => tool.name);
    for (const tool of WALKTHROUGH_RUN_TOOLS) expect(names).toContain(tool.name);
    expect(localComputerResultLine(line, false, false)).toBe(line);
  });

  it("answers a call that is not its own with null, so the pipeline goes on", async () => {
    const { session } = fixture();
    expect(await walkthroughCall({ name: "click", arguments: {} }, { driverVersion: undefined, call: async () => ({}) }, session)).toBeNull();
  });

  it("starts at the first step, naming its control and how it will be checked", async () => {
    const { call, text, session } = fixture();
    const started = await call("start_walkthrough", { ...window, steps: twoSteps });
    expect(started.structuredContent).toMatchObject({ status: "step", index: 0, total: 2, target_state: "found", target: { label: "Dark", element_index: 1, element_token: "s1:1" }, has_check: true });
    expect(text(started)).toContain("Now step 1 of 2: Open the theme list");
    expect(text(started)).toContain("counts as done when the window title has \"Themes\"");
    expect(text(started)).toContain("untrusted screen data");
    expect(session.walkthrough).not.toBeNull();
  });

  it("walks every step: waits, notices the change, checks it against the window, and moves on only then", async () => {
    const { call, state, text } = fixture();
    await call("start_walkthrough", { ...window, steps: twoSteps });
    expect((await call("walkthrough_next", { wait_ms: 500 })).structuredContent).toMatchObject({ status: "waiting", index: 0 });
    state.title = "Themes";
    const second = await call("walkthrough_next", { wait_ms: 5000 });
    expect(second.structuredContent).toMatchObject({ status: "step", index: 1, verified_step: 0 });
    expect(text(second)).toContain("Step 1 was checked: the window title has \"Themes\"");
    state.elements[1] = { element_index: 2, role: "Edit", label: "Name", value: "Ann" };
    const done = await call("walkthrough_next", { wait_ms: 5000 });
    expect(done.structuredContent).toMatchObject({ status: "complete", index: 1, total: 2 });
    expect(text(done)).toContain("All 2 steps were done");
  }, 30_000);

  it("notices a field being filled although the window's shape never moves", async () => {
    const { call, state } = fixture();
    await call("start_walkthrough", { ...window, steps: [twoSteps[1]] });
    state.elements[1] = { element_index: 2, role: "Edit", label: "Name", value: "Ann" };
    expect((await call("walkthrough_next", { wait_ms: 5000 })).structuredContent).toMatchObject({ status: "complete" });
  }, 30_000);

  it("keeps the step and says why when the window changed but its check did not pass", async () => {
    const { call, state, text } = fixture();
    await call("start_walkthrough", { ...window, steps: twoSteps });
    state.title = "Something else";
    const review = await call("walkthrough_next", { wait_ms: 5000 });
    expect(review.structuredContent).toMatchObject({ status: "needs_review", index: 0, reason: "failed" });
    expect(text(review)).toContain("did not pass: the window title does not have \"Themes\"");
    state.title = "Themes";
    expect((await call("walkthrough_next", { wait_ms: 500 })).structuredContent).toMatchObject({ status: "step", index: 1, verified_step: 0 });
  }, 30_000);

  it("never counts a step with no check as done, and takes the caller's confirmation for it", async () => {
    const { call, state } = fixture();
    await call("start_walkthrough", { ...window, steps: [{ instruction: "Look around" }, { instruction: "Press Dark" }] });
    state.title = "Other";
    expect((await call("walkthrough_next", { wait_ms: 5000 })).structuredContent).toMatchObject({ status: "needs_review", reason: "unverified" });
    expect((await call("walkthrough_confirm", { done: false })).structuredContent).toMatchObject({ status: "step", index: 0 });
    expect((await call("walkthrough_confirm", { done: true })).structuredContent).toMatchObject({ status: "step", index: 1, verified_step: 0 });
    expect((await call("walkthrough_confirm", { done: true })).structuredContent).toMatchObject({ status: "complete" });
  }, 30_000);

  it("cancels, says where it stopped, and goes on from that step when started there again", async () => {
    const { call, text } = fixture();
    await call("start_walkthrough", { ...window, steps: twoSteps });
    const cancelled = await call("cancel_walkthrough");
    expect(cancelled.structuredContent).toMatchObject({ status: "cancelled", index: 0 });
    expect(text(cancelled)).toContain("from_step 0");
    expect((await call("walkthrough_next")).structuredContent).toMatchObject({ status: "cancelled" });
    const resumed = await call("start_walkthrough", { ...window, steps: twoSteps, from_step: 1 });
    expect(resumed.structuredContent).toMatchObject({ status: "step", index: 1, instruction: "Type your name" });
  });

  it("replaces a walkthrough that is running when another is started", async () => {
    const { call, session } = fixture();
    await call("start_walkthrough", { ...window, steps: twoSteps });
    const first = session.walkthrough!;
    await call("start_walkthrough", { ...window, steps: [twoSteps[0]] });
    expect(first.walk.finished).toBe(true);
    expect(session.walkthrough).not.toBe(first);
  });

  it("marks the window as one to read again, since the person is changing it", async () => {
    const { call, session } = fixture();
    await call("start_walkthrough", { ...window, steps: twoSteps });
    session.staleWindows.clear();
    await call("walkthrough_next", { wait_ms: 500 });
    expect(session.staleWindows.has("4:9")).toBe(true);
  });

  it.each([
    ["no steps", { ...window, steps: [] }],
    ["too many steps", { ...window, steps: Array.from({ length: 13 }, () => ({ instruction: "x" })) }],
    ["a step with no instruction", { ...window, steps: [{ instruction: "" }] }],
    ["a long instruction", { ...window, steps: [{ instruction: "x".repeat(301) }] }],
    ["a target that is not a label", { ...window, steps: [{ instruction: "x", target: "Save" }] }],
    ["a check that names nothing", { ...window, steps: [{ instruction: "x", expect: {} }] }],
    ["a check on a secret field", { ...window, steps: [{ instruction: "x", expect: { field: { label: "Card number", equals: "1" } } }] }],
    ["a missing window", { steps: [{ instruction: "x" }] }],
    ["a resume point past the end", { ...window, steps: [{ instruction: "x" }], from_step: 3 }],
  ])("refuses %s without reading the window", async (_what, args) => {
    const { call, state, session } = fixture();
    const refused = await call("start_walkthrough", args);
    expect(refused.isError).toBe(true);
    expect(state.reads).toBe(0);
    expect(session.walkthrough).toBeNull();
  });

  it("says there is no walkthrough when asked to go on without one, and keeps waits bounded", async () => {
    const { call } = fixture();
    expect((await call("walkthrough_next")).isError).toBe(true);
    expect((await call("walkthrough_confirm", { done: true })).isError).toBe(true);
    await call("start_walkthrough", { ...window, steps: twoSteps });
    expect((await call("walkthrough_next", { wait_ms: 999_999 })).isError).toBe(true);
    expect((await call("walkthrough_confirm", { done: "yes" })).isError).toBe(true);
  });

  it("is answered by the pipeline only with guidance on, and tells the model what counts as done", async () => {
    const child = { driverVersion: undefined, call: async () => ({}) };
    expect(createComputerPipeline("linux", false, {})({ name: "start_walkthrough", arguments: {} }, child)).toBeNull();
    const answered = createComputerPipeline("linux", false, { guidance: true })({ name: "start_walkthrough", arguments: {} }, child);
    expect(answered).not.toBeNull();
    expect(((await answered) as { isError?: boolean }).isError).toBe(true);
    expect(START_WALKTHROUGH_TOOL.description).toContain("never counted as done");
  });
});
