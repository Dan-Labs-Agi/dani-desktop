import { describe, expect, it } from "vitest";
import { BATCH_LIMIT, BATCH_TOOL, BATCH_TOOLS, COMPUTER_BATCH } from "../batch-tool.ts";

const text = (value: string) => ({ content: [{ type: "text", text: value }] });
const click = { name: "click", arguments: { element_index: 1 } };

describe("computer_batch planning", () => {
  it("takes one to six calls from the tools a batch may hold, with their arguments", () => {
    expect(COMPUTER_BATCH.plan({ calls: [click, { name: "read_window" }] })).toEqual({ calls: [{ name: "click", arguments: { element_index: 1 } }, { name: "read_window", arguments: {} }] });
    expect(COMPUTER_BATCH.plan({ calls: Array.from({ length: BATCH_LIMIT }, () => click) })).toHaveProperty("calls");
  });

  it.each([
    ["no calls", {}],
    ["an empty list", { calls: [] }],
    ["too many", { calls: Array.from({ length: BATCH_LIMIT + 1 }, () => click) }],
    ["a call with no name", { calls: [{ arguments: {} }] }],
    ["a batch inside a batch", { calls: [{ name: "computer_batch", arguments: { calls: [click] } }] }],
    ["a launch", { calls: [click, { name: "launch_app", arguments: { name: "x" } }] }],
    ["a drag", { calls: [{ name: "drag" }] }],
    ["arguments that are not an object", { calls: [{ name: "click", arguments: "1" }] }],
  ])("runs nothing for %s, and says so", (_what, args) => {
    const planned = COMPUTER_BATCH.plan(args as Record<string, unknown>);
    expect(planned).toHaveProperty("error");
    expect((planned as { error: string }).error).toContain("Nothing was run");
  });

  it("lists exactly what it accepts, so the schema and the plan cannot disagree", () => {
    expect(BATCH_TOOL.inputSchema.properties.calls.items.properties.name.enum).toEqual([...BATCH_TOOLS]);
    expect(BATCH_TOOL.inputSchema.properties.calls.maxItems).toBe(BATCH_LIMIT);
  });
});

describe("where a batch stops", () => {
  const stop = (result: Record<string, unknown>) => COMPUTER_BATCH.stopAfter(click, result);
  const receipt = (observation: string, outcome = "driver-reported") => ({ ...text("done"), structuredContent: { actionReceipt: { outcome, observation } } });

  it("goes on after a call whose effect the window showed, a read, and typing that matched or could not be checked", () => {
    expect(stop(receipt("changed"))).toBeNull();
    expect(stop(text("read"))).toBeNull();
    expect(stop({ ...receipt("not-checked"), structuredContent: { actionReceipt: { outcome: "driver-reported", observation: "not-checked" }, typing_verification: "matched" } })).toBeNull();
    expect(stop({ ...text("typed"), structuredContent: { typing_verification: "not_checked" } })).toBeNull();
  });

  it.each([
    ["an error", { isError: true, ...text("no") }, "refused or failed"],
    ["a call the checks blocked", receipt("not-checked", "blocked"), "refused or failed"],
    ["an action that errored", receipt("not-checked", "error"), "refused or failed"],
    ["a window that did not change", receipt("unchanged"), "did not change"],
    ["an effect the window does not show", receipt("unobserved"), "not one the window shows"],
    ["typing the field does not hold", { ...text("t"), structuredContent: { typing_verification: "differs" } }, "does not hold"],
    ["a field that could not be read back", { ...text("t"), structuredContent: { typing_verification: "unreadable" } }, "could not be read back"],
  ])("stops at %s", (_what, result, why) => {
    expect(stop(result as Record<string, unknown>)).toContain(why);
  });
});

describe("what a batch answers", () => {
  const done = [{ call: click, result: text("Clicked Save.") }, { call: { name: "read_window", arguments: {} }, result: text("lines") }];

  it("says what each call said, in order, and that all of them ran", () => {
    const answer = COMPUTER_BATCH.answer(done, 2, null);
    expect(answer).not.toHaveProperty("isError");
    expect((answer.content as Array<{ text: string }>)[0]!.text).toBe("1. click\nClicked Save.\n2. read_window\nlines\nRan all 2 calls.");
    expect(answer.structuredContent).toEqual({ planned: 2, ran: 2, stopped: null, calls: [{ name: "click", ok: true }, { name: "read_window", ok: true }] });
  });

  it("says where it stopped and that the rest were not made", () => {
    const answer = COMPUTER_BATCH.answer([done[0]!], 4, "the window did not change");
    expect((answer.content as Array<{ text: string }>)[0]!.text).toContain("Ran 1 of 4 calls and stopped: the window did not change. The rest were not made.");
    expect(answer).not.toHaveProperty("isError");
  });

  it("is an error when a call in it failed, and cuts a very long answer", () => {
    const answer = COMPUTER_BATCH.answer([{ call: click, result: { isError: true, ...text("x".repeat(5_000)) } }], 3, "it was refused or failed");
    expect(answer.isError).toBe(true);
    const shown = (answer.content as Array<{ text: string }>)[0]!.text;
    expect(shown).toContain("1. click (failed)");
    expect(shown).toContain("[shortened]");
    expect(shown.length).toBeLessThan(3_300);
  });
});
