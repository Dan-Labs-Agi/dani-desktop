import { describe, expect, it } from "vitest";
import type { ChildCalls } from "../server/mcp-bridge.ts";
import { createComputerPipeline } from "./pipeline.ts";
import { localComputerResultLine, COMPUTER_WORK_GUIDANCE } from "./guidance.ts";
import { gatedLocalComputer } from "./local-computer.ts";

describe("computer pipeline", () => {
  it("reuses the last read-back for the next action on the same window", async () => {
    const calls: string[] = [];
    let revision = 0;
    const child: ChildCalls = {
      driverVersion: "0.28.2",
      call: async (name) => {
        calls.push(name);
        if (name === "get_window_state") {
          return { structuredContent: { app_name: "Notes", window_title: `Revision ${revision}`, elements: [] } };
        }
        revision += 1;
        return { content: [{ type: "text", text: "sent" }] };
      },
    };
    const relay = createComputerPipeline("linux", true, { loop: true });
    const call = { name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } };
    await relay(call, child);
    await relay(call, child);
    expect(calls).toEqual(["get_window_state", "click", "get_window_state", "click", "get_window_state"]);
  });

  it("adds short workflow guidance only to screen-reading tool descriptions", () => {
    const frame = JSON.stringify({ jsonrpc: "2.0", id: 3, result: { tools: [
      { name: "get_window_state", description: "Read a window" },
      { name: "click", description: "Click" },
    ] } });
    const result = JSON.parse(localComputerResultLine(frame, false, true));
    expect(result.result.tools[0].description).toContain(COMPUTER_WORK_GUIDANCE);
    expect(result.result.tools[1].description).toBe("Click");
  });

  it("refuses a stale index until the window is read again", async () => {
    let title = "Before";
    const calls: string[] = [];
    const child: ChildCalls = {
      driverVersion: "0.28.2",
      call: async (name) => {
        calls.push(name);
        if (name === "get_window_state") return { structuredContent: { app_name: "Notes", window_title: title, elements: [] } };
        title = "After";
        return { content: [{ type: "text", text: "sent" }] };
      },
    };
    const relay = createComputerPipeline("linux", false, { stale: true });
    const read = { name: "get_window_state", arguments: { pid: 1, window_id: 2 } };
    const click = { name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } };
    await relay(read, child);
    await relay(click, child);
    const refused = await relay(click, child) as { isError: boolean; content: Array<{ text: string }> };
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("Read it again");
    expect(calls.filter((name) => name === "click")).toHaveLength(1);
    await relay(read, child);
    await relay(click, child);
    expect(calls.filter((name) => name === "click")).toHaveLength(2);
  });

  it("refuses a third unchanged action with the same arguments", async () => {
    const calls: string[] = [];
    const child: ChildCalls = {
      driverVersion: "0.28.2",
      call: async (name) => {
        calls.push(name);
        return name === "get_window_state"
          ? { structuredContent: { app_name: "Notes", window_title: "Still", elements: [] } }
          : { content: [{ type: "text", text: "sent" }] };
      },
    };
    const relay = createComputerPipeline("linux", false, { loop: true });
    const click = { name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } };
    await relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child);
    await relay(click, child);
    await relay(click, child);
    const refused = await relay(click, child) as { isError: boolean; content: Array<{ text: string }> };
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("unchanged twice");
    expect(calls.filter((name) => name === "click")).toHaveLength(2);
  });

  it("passes enabled guard flags only to the isolated computer service", () => {
    const descriptor = {
      command: "fixture-driver", args: ["mcp"], env: {}, platform: "win32" as const, scope: "local-computer" as const,
    };
    const control = { url: "http://127.0.0.1:1234/control", token: "fixture-token" };
    const enabled = gatedLocalComputer(descriptor, control, false, false, { stale: true, loop: true });
    expect(enabled.env).toMatchObject({ OMB_COMPUTER_STALE: "1", OMB_COMPUTER_LOOP: "1" });
    const disabled = gatedLocalComputer(descriptor, control);
    expect(disabled.env).not.toHaveProperty("OMB_COMPUTER_STALE");
    expect(disabled.env).not.toHaveProperty("OMB_COMPUTER_LOOP");
  });

  it("does not invalidate an element token with a private before-read", async () => {
    let generation = 0;
    let sent = false;
    const child: ChildCalls = {
      driverVersion: "0.28.2",
      call: async (name, args) => {
        if (name === "get_window_state") {
          generation += 1;
          return { structuredContent: { app_name: "Notes", window_title: sent ? "After" : "Before", elements: [
            { element_index: 1, element_token: `token-${generation}`, role: "AXButton", depth: 1, label: "Save" },
          ] } };
        }
        if (args.element_token !== `token-${generation}`) return { isError: true };
        sent = true;
        return { content: [{ type: "text", text: "sent" }] };
      },
    };
    const relay = createComputerPipeline("linux", true);
    await relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child);
    const result = await relay({ name: "click", arguments: { pid: 1, window_id: 2, element_token: "token-1" } }, child) as { isError?: boolean };
    expect(result.isError).not.toBe(true);
    expect(sent).toBe(true);
    expect(generation).toBe(2);
  });

  it("caps a session even when actions have no window to verify", async () => {
    let sent = 0;
    const child: ChildCalls = { driverVersion: "0.28.2", call: async () => { sent += 1; return {}; } };
    const relay = createComputerPipeline("linux", false, { loop: true });
    const action = { name: "press_key", arguments: { key: "Escape" } };
    for (let index = 0; index < 100; index += 1) await relay(action, child);
    const refusal = await relay(action, child) as { isError: boolean };
    expect(sent).toBe(100);
    expect(refusal.isError).toBe(true);
  });

  describe("the visible pointer", () => {
    const recording = () => {
      const calls: string[] = [];
      const child: ChildCalls = { driverVersion: "0.28.2", call: async (name) => { calls.push(name); return { content: [{ type: "text", text: "sent" }] }; } };
      return { calls, child };
    };

    it("is turned on once, before the first action, and never for a read", async () => {
      const { calls, child } = recording();
      const relay = createComputerPipeline("linux", false, { pointer: true });
      expect(relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child)).toBeNull();
      await relay({ name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } }, child);
      await relay({ name: "press_key", arguments: { key: "Escape" } }, child);
      expect(calls).toEqual(["set_agent_cursor_enabled", "set_agent_cursor_motion", "click"]);
      expect(relay({ name: "press_key", arguments: { key: "Escape" } }, child)).toBeNull();
    });

    it("does nothing while its switch is off", () => {
      const { child } = recording();
      expect(createComputerPipeline("linux")({ name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } }, child)).toBeNull();
    });

    it("still performs the action when the driver has no cursor to show", async () => {
      const calls: string[] = [];
      const child: ChildCalls = { driverVersion: "0.28.2", call: async (name) => {
        calls.push(name);
        return name === "set_agent_cursor_enabled" ? { isError: true } : { content: [{ type: "text", text: "sent" }] };
      } };
      const answer = await createComputerPipeline("linux", false, { pointer: true })({ name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } }, child) as { isError?: boolean };
      expect(answer.isError).not.toBe(true);
      expect(calls).toEqual(["set_agent_cursor_enabled", "click"]);
    });
  });

  describe("what a session counts", () => {
    it("counts actions, verdicts and the reads it made for itself, but not the agent's own reads", async () => {
      let revision = 0;
      const child: ChildCalls = { driverVersion: "0.28.2", call: async (name) => {
        if (name === "get_window_state") return { structuredContent: { app_name: "Notes", window_title: `Revision ${revision}`, elements: [] } };
        if (name === "type_text") return { content: [{ type: "text", text: "typed" }] };
        revision += 1;
        return { content: [{ type: "text", text: "sent" }] };
      } };
      const relay = createComputerPipeline("linux", true, { evidence: true });
      await relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child);
      await relay({ name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } }, child);
      const counters = relay.counters();
      expect(counters).toMatchObject({ actions: 1, changed: 1, unchanged: 0, unobserved: 0, readBacks: 2 });
      expect(counters.addedMs).toBeGreaterThanOrEqual(0);
    });

    it("counts a held-back call by the part that held it back, and counts nothing for a call it never saw", async () => {
      let title = "Before";
      const child: ChildCalls = { driverVersion: "0.28.2", call: async (name) => {
        if (name === "get_window_state") return { structuredContent: { app_name: "Notes", window_title: title, elements: [] } };
        title = "After";
        return { content: [{ type: "text", text: "sent" }] };
      } };
      const relay = createComputerPipeline("linux", false, { stale: true, evidence: true });
      const click = { name: "click", arguments: { pid: 1, window_id: 2, element_index: 3 } };
      await relay({ name: "get_window_state", arguments: { pid: 1, window_id: 2 } }, child);
      await relay(click, child);
      await relay(click, child);
      expect(relay.counters()).toMatchObject({ actions: 1, changed: 1, refusals: { stale: 1 } });
    });

    it("reports a copy that later actions cannot change", async () => {
      const child: ChildCalls = { driverVersion: "0.28.2", call: async () => ({}) };
      const relay = createComputerPipeline("linux", false, { evidence: true });
      const before = relay.counters();
      await relay({ name: "press_key", arguments: { key: "Escape" } }, child);
      expect(before.actions).toBe(0);
      expect(relay.counters().actions).toBe(1);
    });
  });
});
