import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { COMPUTER_EVIDENCE_PATH } from "./evidence.ts";
import { gatedLocalComputer } from "./local-computer.ts";

// A disposable driver: a window whose title moves when it is clicked. It never opens a real window.
const DRIVER = `
const readline = require("node:readline");
let revision = 0;
const calls = [];
const text = (value) => ({ content: [{ type: "text", text: value }] });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  if (message.method !== "tools/call") return reply({});
  const name = message.params.name;
  calls.push(name);
  if (name === "get_window_state") {
    return reply({ ...text(JSON.stringify(calls)), structuredContent: { pid: 4, window_id: 9, app_name: "Notes", window_title: "Revision " + revision,
      elements: [{ element_index: 1, role: "AXButton", label: "Save", depth: 1 }] } });
  }
  if (name === "environment") return reply(text(Object.keys(process.env).filter((key) => /^OMB_(COMPUTER_|CONTROL_|CUA_)/.test(key)).sort().join(",")));
  if (name === "click") revision += 1;
  return reply(text("done:" + name));
});
`;

async function session(guards: Parameters<typeof gatedLocalComputer>[4], verifyEffects = true) {
  const folder = mkdtempSync(join(tmpdir(), "computeruse-service-"));
  const driver = join(folder, "driver.cjs");
  writeFileSync(driver, DRIVER);
  const evidence: Array<{ auth: string | undefined; body: any }> = [];
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === COMPUTER_EVIDENCE_PATH) {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        evidence.push({ auth: request.headers.authorization, body: JSON.parse(raw) });
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ held: false, helpOpen: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const control = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/control`, token: "turn-token" };
  const connection = gatedLocalComputer(
    { command: process.execPath, args: [driver], env: {}, platform: "linux", scope: "local-computer" }, control, false, verifyEffects, guards);
  const child: ChildProcess = spawn(connection.command, connection.args, { env: { ...process.env, ...connection.env }, stdio: ["pipe", "pipe", "inherit"] });
  const replies = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const message = JSON.parse(line);
    replies.get(message.id)?.(message);
    replies.delete(message.id);
  });
  let next = 0;
  const call = (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer for ${name}`)), 10_000);
      replies.set(id, (value) => { clearTimeout(timer); resolve(value.result); });
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
  };
  const close = async () => {
    const exited = once(child, "exit");
    child.stdin!.end();
    await exited;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  };
  return { call, close, evidence };
}

const window = { pid: 4, window_id: 9 };

describe("the computer service with its checks on", () => {
  it("shows the pointer before the first action, verifies the click, and reports the totals", async () => {
    const run = await session({ pointer: true, evidence: true, stale: true });
    try {
      await run.call("get_window_state", window);
      const clicked = await run.call("click", { ...window, element_index: 1 });
      expect(clicked.content).toEqual([{ type: "text", text: "done:click" }]);
      const calls = JSON.parse((await run.call("get_window_state", window)).content[0].text) as string[];
      expect(calls.indexOf("set_agent_cursor_enabled")).toBeGreaterThan(-1);
      expect(calls.indexOf("set_agent_cursor_enabled")).toBeLessThan(calls.indexOf("click"));
      expect(calls.indexOf("set_agent_cursor_motion")).toBeLessThan(calls.indexOf("click"));
      await vi_waitFor(() => run.evidence.length > 0);
    } finally {
      await run.close();
    }
    expect(run.evidence.at(-1)!.auth).toBe("Bearer turn-token");
    expect(run.evidence.at(-1)!.body).toMatchObject({ actions: 1, changed: 1, unchanged: 0 });
  }, 30_000);

  it("never hands a switch, or the turn's token, to the driver", async () => {
    const run = await session({ pointer: true, evidence: true, stale: true, loop: true, typing: true });
    try {
      const names = (await run.call("environment")).content[0].text as string;
      expect(names).toBe("");
    } finally {
      await run.close();
    }
  }, 30_000);

  it("leaves a plain session exactly as it was: no pointer, no read-backs, no report", async () => {
    const run = await session({}, false);
    try {
      await run.call("click", { ...window, element_index: 1 });
      const calls = JSON.parse((await run.call("get_window_state", window)).content[0].text) as string[];
      expect(calls).toEqual(["click", "get_window_state"]);
    } finally {
      await run.close();
    }
    expect(run.evidence).toEqual([]);
  }, 30_000);
});

async function vi_waitFor(check: () => boolean, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
