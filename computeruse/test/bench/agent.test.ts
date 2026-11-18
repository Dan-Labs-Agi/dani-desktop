import { describe, expect, it } from "vitest";
import { runScriptedAgent, type Rpc, type RpcResult } from "../../bench/agent.ts";
import { createDesktop, type DesktopSpec } from "../../bench/desktop.ts";
import type { Intent } from "../../bench/task.ts";

const notes: DesktopSpec = { windows: [{ id: 1, title: "Notes", app: "Notes", elements: [
  { role: "AXTextField", label: "Body" },
  { role: "AXButton", label: "Save", on: [{ do: "writeFile", path: "note.txt", content: "{Body}" }] },
] }] };

const direct = (desktop = createDesktop(notes)): { rpc: Rpc; desktop: ReturnType<typeof createDesktop> } => ({ desktop, rpc: async (name, args) => desktop.handle(name, args) as RpcResult });
const run = (intents: Intent[], rpc: Rpc) => runScriptedAgent(intents, rpc);

describe("the scripted agent", () => {
  it("finds things by window title and label, and does what it is told", async () => {
    const { rpc, desktop } = direct();
    const out = await run([
      { do: "set", window: "Notes", label: "Body", value: "hello" },
      { do: "click", window: "Notes", label: "Save" },
    ], rpc);
    expect(desktop.snapshot().files["note.txt"]).toBe("hello");
    expect(out.gaveUp).toBeUndefined();
    expect(out.calls).toBeGreaterThan(2);
  });

  it("reads a window before acting on it, as a model must, and again only when told to", async () => {
    const { rpc } = direct();
    const seen: string[] = [];
    const watching: Rpc = async (name, args) => { seen.push(name); return rpc(name, args); };
    await run([{ do: "click", window: "Notes", label: "Save" }, { do: "click", window: "Notes", label: "Save" }], watching);
    expect(seen.filter((name) => name === "get_window_state")).toHaveLength(1);
    seen.length = 0;
    await run([{ do: "click", window: "Notes", label: "Save", fresh: true }, { do: "click", window: "Notes", label: "Save", fresh: true }], watching);
    expect(seen.filter((name) => name === "get_window_state")).toHaveLength(2);
  });

  it("uses its own last read after a scroll, so a stale index lands on another row", async () => {
    const list: DesktopSpec = { windows: [{ id: 1, title: "Files", app: "Finder", elements: [], scroll: { rows: ["A", "B", "C", "D", "E", "F"], page: 3 } }] };
    const { rpc, desktop } = direct(createDesktop(list));
    await run([
      { do: "read", window: "Files" },
      { do: "scroll", window: "Files", direction: "down", amount: 2 },
      { do: "click", window: "Files", label: "B" },
    ], rpc);
    expect(desktop.snapshot().api.selected).toBe("D");
  });

  it("reads again and tries once more when the window shows no change and the step says repeating is safe", async () => {
    const swallowing: DesktopSpec = { windows: [{ id: 1, title: "W", app: "A", elements: [
      { role: "AXButton", label: "Apply", inertClicks: 1, on: [{ do: "setSetting", name: "applied", value: "yes" }] }] }] };
    const { rpc, desktop } = direct(createDesktop(swallowing));
    const telling: Rpc = async (name, args) => {
      const result = await rpc(name, args);
      return name === "click" && desktop.snapshot().settings.applied === undefined
        ? { ...result, content: [...result.content!, { type: "text", text: "The click was sent, and the window shows no change afterwards." }] } : result;
    };
    await run([{ do: "click", window: "W", label: "Apply", safeToRepeat: true }], telling);
    expect(desktop.snapshot().settings.applied).toBe("yes");
    expect(desktop.snapshot().api["calls.click"]).toBe("2");
  });

  it("does not repeat a click only because the window shows no change, unless the step says repeating is safe", async () => {
    const saving: DesktopSpec = { windows: [{ id: 1, title: "W", app: "A", elements: [{ role: "AXButton", label: "Add", on: [{ do: "setApi", key: "added", value: "1" }] }] }] };
    const { rpc, desktop } = direct(createDesktop(saving));
    const telling: Rpc = async (name, args) => {
      const result = await rpc(name, args);
      return name === "click" ? { ...result, content: [...result.content!, { type: "text", text: "The click was sent, and the window shows no change afterwards." }] } : result;
    };
    await run([{ do: "click", window: "W", label: "Add" }], telling);
    expect(desktop.snapshot().api["calls.click"]).toBe("1");
  });

  it("does not read the notes it was never shown: without them a swallowed click is simply lost", async () => {
    const swallowing: DesktopSpec = { windows: [{ id: 1, title: "W", app: "A", elements: [
      { role: "AXButton", label: "Apply", inertClicks: 1, on: [{ do: "setSetting", name: "applied", value: "yes" }] }] }] };
    const { rpc, desktop } = direct(createDesktop(swallowing));
    await run([{ do: "click", window: "W", label: "Apply" }], rpc);
    expect(desktop.snapshot().settings.applied).toBeUndefined();
  });

  it("never repeats a final action because it looked unchanged", async () => {
    const mail: DesktopSpec = { windows: [{ id: 1, title: "Mail", app: "Mail", elements: [{ role: "AXButton", label: "Send", on: [{ do: "setApi", key: "sent", value: "yes" }] }] }] };
    const { rpc, desktop } = direct(createDesktop(mail));
    const telling: Rpc = async (name, args) => {
      const result = await rpc(name, args);
      return name === "click" ? { ...result, content: [...result.content!, { type: "text", text: "The click was sent, and the window shows no change afterwards." }] } : result;
    };
    await run([{ do: "click", window: "Mail", label: "Send", safeToRepeat: true }], telling);
    expect(desktop.snapshot().api["calls.click"]).toBe("1");
  });

  it("calls again, unchanged, when told a yes is waiting for that exact call", async () => {
    const { rpc, desktop } = direct();
    let first = true;
    const holding: Rpc = async (name, args) => {
      if (name === "click" && first) {
        first = false;
        return { isError: true, content: [{ type: "text", text: "The person said yes to this one action. This call was NOT performed: call it again now and it goes through once." }] };
      }
      return rpc(name, args);
    };
    await run([{ do: "set", window: "Notes", label: "Body", value: "x" }, { do: "click", window: "Notes", label: "Save" }], holding);
    expect(desktop.snapshot().files["note.txt"]).toBe("x");
  });

  it("stops, and says why, when a call is refused for good", async () => {
    const { rpc, desktop } = direct();
    const refusing: Rpc = async (name, args) => name === "click"
      ? { isError: true, content: [{ type: "text", text: "The person said no to this, so it was NOT done." }] } : rpc(name, args);
    const out = await run([{ do: "click", window: "Notes", label: "Save" }, { do: "set", window: "Notes", label: "Body", value: "never" }], refusing);
    expect(out.gaveUp).toMatch(/said no/);
    expect(desktop.snapshot().api["calls.set_value"]).toBeUndefined();
  });

  it("repeats an intent the number of times asked, until something stops it", async () => {
    const { rpc, desktop } = direct();
    await run([{ do: "click", window: "Notes", label: "Save", repeat: 4 }], rpc);
    expect(desktop.snapshot().api["calls.click"]).toBe("4");
  });

  it("reads a value off the screen by what follows a label, or the last row, and notes what it saw of a read", async () => {
    const sheet: DesktopSpec = { windows: [{ id: 1, title: "Sheet", app: "Cells", elements: [
      { role: "AXStaticText", label: "Total" }, { role: "AXStaticText", label: "42" }], scroll: { rows: ["x", "y", "Zed"], page: 3 } }] };
    const { rpc } = direct(createDesktop(sheet));
    const out = await run([
      { do: "extract", window: "Sheet", after: "Total", as: "total" },
      { do: "extract", window: "Sheet", last: true, as: "last" },
      { do: "read", window: "Sheet", record: { key: "plain", startsWith: "Screen data from" } },
    ], rpc);
    expect(out.extracted).toEqual({ total: "42", last: "Zed", plain: "no" });
  });

  it("reads what a field holds, and an empty string for a field whose value it was not given when the step allows it", async () => {
    const form: DesktopSpec = { windows: [{ id: 1, title: "Form", app: "Forms", elements: [{ role: "AXTextField", label: "Body", value: "draft" }, { role: "AXButton", label: "Go" }] }] };
    const { rpc } = direct(createDesktop(form));
    const out = await run([
      { do: "extract", window: "Form", readField: "Body", as: "body" },
      { do: "extract", window: "Form", readField: "Go", optional: true, as: "go" },
    ], rpc);
    expect(out.extracted).toEqual({ body: "draft", go: "" });
    const strict = await run([{ do: "extract", window: "Form", readField: "Go", as: "go" }], rpc);
    expect(strict.scriptError).toMatch(/shows no value/);
  });

  it("reports a script that names something that is not on screen, rather than guessing", async () => {
    const { rpc } = direct();
    const out = await run([{ do: "click", window: "Notes", label: "Nope" }], rpc);
    expect(out.scriptError).toMatch(/Nope/);
    const missing = await run([{ do: "click", window: "Ghost", label: "Save" }], rpc);
    expect(missing.scriptError).toMatch(/Ghost/);
  });
});
