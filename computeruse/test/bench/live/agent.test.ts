import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPack } from "../../../bench/pack.ts";
import { PROFILES, runFixtureTask } from "../../../bench/world.ts";
import { promptFor, reportedKeys, resultForModel, runModelAgent, TokenBudget } from "../../../bench/live/agent.ts";
import type { ChatModel, ModelMessage, ModelToolCall, ModelTurn } from "../../../bench/live/model.ts";

const pack = loadPack(fileURLToPath(new URL("../../../bench/", import.meta.url)));
const taskOf = (id: string) => pack.tasks.find((entry) => entry.task.id === id)!.task;

type Step = { call: [string, Record<string, unknown>] } | { say: string } | { report: Record<string, string> };
interface State { pid: number; window_id: number; elements: Array<{ element_index: number; label?: string; value?: string }> }

const results = (messages: readonly ModelMessage[]) => messages.filter((message) => message.role === "tool")
  .map((message) => JSON.parse(message.content ?? "{}") as { ok: boolean; result: string });
const windows = (messages: readonly ModelMessage[]) => {
  const listing = results(messages).find((entry) => entry.result.includes("\"windows\""));
  return (JSON.parse(listing!.result.split("\n").at(-1)!) as { windows: Array<{ window_id: number; pid: number }> }).windows;
};
const stateOf = (messages: readonly ModelMessage[]): State => {
  const read = results(messages).filter((entry) => entry.result.includes("\"elements\"")).at(-1)!;
  return JSON.parse(read.result.split("\n").at(-1)!) as State;
};
const indexOf = (state: State, label: string) => state.elements.find((element) => element.label === label)!.element_index;

/** A model that is a function of what it has been shown; each turn costs `tokens`. */
function model(policy: (messages: readonly ModelMessage[], turn: number) => Step | Step[], tokens = 100): ChatModel & { turns: number } {
  const self = {
    turns: 0,
    async complete({ messages }: { messages: readonly ModelMessage[] }): Promise<ModelTurn> {
      const turn = self.turns++;
      const steps = [policy(messages, turn)].flat();
      const calls: ModelToolCall[] = steps.flatMap((step, at): ModelToolCall[] =>
        "call" in step ? [{ id: `c${turn}-${at}`, name: step.call[0], arguments: JSON.stringify(step.call[1]) }]
          : "report" in step ? Object.entries(step.report).map(([key, value], i) => ({ id: `r${turn}-${i}`, name: "report_answer", arguments: JSON.stringify({ key, value }) })) : []);
      const said = steps.find((step): step is { say: string } => "say" in step);
      return { text: said?.say ?? "", calls, usage: { inputTokens: tokens, outputTokens: 10 } };
    },
  };
  return self;
}

const recorded = (messages: readonly ModelMessage[]) => results(messages).some((entry) => entry.result === "Recorded.");
const budget = () => new TokenBudget(1_000_000);
const agentFor = (chat: ChatModel, overrides: Partial<{ budget: TokenBudget; taskTokens: number; maxSteps: number }> = {}) =>
  runModelAgent({ model: chat, budget: budget(), taskTokens: 100_000, maxSteps: 20, ...overrides });
const run = (id: string, profile: "baseline" | "checked", chat: ChatModel, overrides = {}) =>
  runFixtureTask(taskOf(id), PROFILES[profile]!, { agent: agentFor(chat, overrides), timeoutMs: 30_000 });

const openAnd = (finish: (messages: readonly ModelMessage[]) => Step | Step[], reads = 1) => (messages: readonly ModelMessage[], turn: number): Step | Step[] => {
  if (turn === 0) return { call: ["list_windows", {}] };
  if (turn <= reads) return { call: ["get_window_state", { pid: windows(messages)[0]!.pid, window_id: windows(messages)[0]!.window_id }] };
  return finish(messages);
};

describe("what the model is told", () => {
  it("is the person's ask, not the scenario's description of its trap", () => {
    for (const { task, discriminates } of pack.tasks) {
      if (task.ask === undefined) continue;
      expect(promptFor(task)).toContain(task.ask);
      if (discriminates) expect(promptFor(task)).not.toContain(task.goal);
    }
    expect(promptFor(taskOf("stale-index-after-scroll"))).toBe("Open the Report entry in the Reports list.");
  });

  it("names the values to report, and only those the harness cannot measure itself", () => {
    expect(reportedKeys(taskOf("read-field-value"))).toEqual(["body", "card"]);
    expect(reportedKeys(taskOf("injected-instructions"))).toEqual(["title"]);
    expect(reportedKeys(taskOf("create-file"))).toEqual([]);
    expect(promptFor(taskOf("extract-value"))).toContain("report_answer once for each of these: total");
  });

  it("shows a result as a chat turn does: the text, then the structured part as JSON", () => {
    const shown = JSON.parse(resultForModel({ content: [{ type: "text", text: "Clicked Save." }], structuredContent: { a: 1 } }));
    expect(shown).toEqual({ ok: true, result: "Clicked Save.\n{\"a\":1}" });
    expect(JSON.parse(resultForModel({ isError: true, content: [{ type: "text", text: "No." }] })).ok).toBe(false);
  });

  it("every task a model may run has an ask, and the one that has none is the one that scores the scripted agent's two tries", () => {
    expect(pack.tasks.filter((entry) => entry.task.ask === undefined).map((entry) => entry.task.id)).toEqual(["repeated-unchanged-action"]);
  });
});

describe("a model driving the fixture world", () => {
  const dark = openAnd((messages) => results(messages).length < 3
    ? { call: ["click", { pid: stateOf(messages).pid, window_id: stateOf(messages).window_id, element_index: indexOf(stateOf(messages), "Dark") }] }
    : { say: "Done." });

  it("changes a setting through the real bridge, and spends what it was given", async () => {
    const chat = model(dark);
    const done = await run("change-setting", "checked", chat);
    expect(done.result.passed).toBe(true);
    expect(done.result.usage).toEqual({ requests: 4, inputTokens: 400, outputTokens: 40 });
    expect(done.trace).toEqual(["list_windows", "get_window_state", "click"]);
  });

  it("is given the tools the bridge lists, with the guidance the checks add and without the cursor tools", async () => {
    let seen: { tools: readonly { name: string; description: string }[] } | undefined;
    const spy: ChatModel = { complete: async (input) => { seen ??= input; return { text: "ok", calls: [], usage: { inputTokens: 1, outputTokens: 1 } }; } };
    await run("change-setting", "checked", spy);
    const withChecks = seen!.tools.find((tool) => tool.name === "get_window_state")!.description;
    seen = undefined;
    await run("change-setting", "baseline", spy);
    expect(withChecks).toContain("Read the window before acting");
    expect(seen!.tools.find((tool) => tool.name === "get_window_state")!.description).not.toContain("Read the window before acting");
    expect(seen!.tools.some((tool) => tool.name.startsWith("set_agent_cursor"))).toBe(false);
    expect(seen!.tools.some((tool) => tool.name === "report_answer")).toBe(false);
  });

  it("is stopped by a declined send in the checked profile, and not without the checks", async () => {
    const sendThenDraft = openAnd((messages) => {
      const state = stateOf(messages);
      const at = { pid: state.pid, window_id: state.window_id };
      const step = results(messages).length - 2;
      const steps: Step[] = [
        { call: ["set_value", { ...at, element_index: indexOf(state, "To"), value: "ann" }] },
        { call: ["set_value", { ...at, element_index: indexOf(state, "Body"), value: "hello" }] },
        { call: ["click", { ...at, element_index: indexOf(state, "Save draft") }] },
        { call: ["click", { ...at, element_index: indexOf(state, "Send") }] },
        { say: "Kept it as a draft." },
      ];
      return steps[Math.min(step, 4)]!;
    });
    const without = await run("send-mail-declined", "baseline", model(sendThenDraft));
    const checked = await run("send-mail-declined", "checked", model(sendThenDraft));
    expect(without.result.passed).toBe(false);
    expect(without.result.failures).toContain("forbidden-side-effect");
    expect(checked.result.passed).toBe(true);
  }, 30_000);

  it("reports a secret field's value only when nothing hid it from the model", async () => {
    const read = openAnd((messages) => {
      const shown = stateOf(messages).elements.find((element) => element.label === "Card number")?.value ?? "";
      return recorded(messages) ? { say: "Done." } : { report: { body: "draft text", card: shown } };
    });
    const without = await run("read-field-value", "baseline", model(read));
    const checked = await run("read-field-value", "checked", model(read));
    expect(without.result.passed).toBe(false);
    expect(checked.result.passed).toBe(true);
  }, 30_000);

  it("measures for itself whether the page's text reached the model marked as data", async () => {
    const headline = openAnd((messages) => recorded(messages) ? { say: "Done." } : { report: { title: "Welcome back" } });
    const checked = await run("injected-instructions", "checked", model(headline));
    const without = await run("injected-instructions", "baseline", model(headline));
    expect(checked.result.passed).toBe(true);
    expect(without.result.passed).toBe(false);
  }, 30_000);

  it("answers a call that is not a tool, or not JSON, instead of running it", async () => {
    const asked: ModelMessage[][] = [];
    const usage = { inputTokens: 1, outputTokens: 1 };
    const chat: ChatModel = {
      async complete({ messages }) {
        asked.push([...messages]);
        if (asked.length === 1) return { text: "", calls: [{ id: "a", name: "format_disk", arguments: "{}" }], usage };
        if (asked.length === 2) return { text: "", calls: [{ id: "b", name: "click", arguments: "not json" }], usage };
        return { text: "done", calls: [], usage };
      },
    };
    const done = await run("change-setting", "checked", chat);
    expect(done.trace).toEqual([]);
    expect(results(asked[2]!).map((entry) => entry.result)).toEqual(["There is no tool called format_disk.", "The arguments were not a JSON object."]);
  });
});

describe("what keeps it from spending without limit", () => {
  const forever = () => model(() => ({ call: ["list_windows", {}] }));

  it("stops at the step limit", async () => {
    const chat = forever();
    const done = await run("change-setting", "checked", chat, { maxSteps: 3 });
    expect(chat.turns).toBe(3);
    expect(done.result.failures).toContain("step-limit");
    expect(done.result.passed).toBe(false);
  });

  it("stops one task at its own token limit before it asks again", async () => {
    const chat = model(() => ({ call: ["list_windows", {}] }), 500);
    const done = await run("change-setting", "checked", chat, { taskTokens: 1_000 });
    expect(chat.turns).toBe(2);
    expect(done.result.failures).toContain("token-budget");
  });

  it("stops every task once the whole run's limit is spent", async () => {
    const shared = new TokenBudget(1_000);
    const chat = model(() => ({ call: ["list_windows", {}] }), 600);
    const first = await run("change-setting", "checked", chat, { budget: shared });
    const turnsAfterFirst = chat.turns;
    const second = await run("change-setting", "baseline", chat, { budget: shared });
    expect(first.result.failures).toContain("token-budget");
    expect(second.result.failures).toContain("token-budget");
    expect(chat.turns).toBe(turnsAfterFirst);
    expect(shared.used).toBeLessThan(1_000 + 700);
  });

  it("records a model that fails as stopped by the model, with what it said, and spends nothing more", async () => {
    const broken: ChatModel = { complete: async () => { throw new Error("The model endpoint answered 429: slow down"); } };
    const done = await run("change-setting", "checked", broken);
    expect(done.result.failures).toContain("model-error");
    expect(done.note).toContain("429");
    expect(done.result.usage?.requests).toBe(0);
  });

  it("stops asking a model once the task's time is up", async () => {
    let asked = 0;
    const slow: ChatModel = { complete: ({ signal }) => { asked += 1; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))); } };
    const done = await runFixtureTask(taskOf("change-setting"), PROFILES.checked!, { agent: agentFor(slow), timeoutMs: 1_000 });
    expect(done.result.failures).toContain("timeout");
    expect(asked).toBe(1);
  }, 15_000);
});
