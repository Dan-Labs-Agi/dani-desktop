import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BRIDGE = fileURLToPath(new URL("../computeruse/testing/batch-bridge.ts", import.meta.url));

// A disposable MCP child: it answers a call with its name, or "stop-here" for the one called "halt", and notes the order.
const DRIVER = `
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  const name = message.params.name;
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: name === "halt" ? "stop-here" : "driver:" + name }] } }) + "\\n");
});
`;

async function session() {
  const folder = mkdtempSync(join(tmpdir(), "bridge-batch-"));
  const driver = join(folder, "driver.cjs");
  writeFileSync(driver, DRIVER);
  const journal: string[] = [];
  const checked: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.writeHead(200, { "content-type": "application/json" });
    if (request.method === "POST") {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => { journal.push(JSON.parse(raw).tool); response.end("{}"); });
      return;
    }
    const tool = url.searchParams.get("tool") ?? "";
    checked.push(tool);
    response.end(JSON.stringify(tool === "blocked" ? { held: true, helpOpen: false, blockedReason: "The person said no." } : { held: false, helpOpen: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bridge = spawn(process.execPath, ["--experimental-strip-types", BRIDGE, process.execPath, driver], {
    env: { ...process.env, TEST_CONTROL: `${base}/control`, TEST_JOURNAL: `${base}/journal` }, stdio: ["pipe", "pipe", "inherit"],
  });
  const answers = new Map<number, any>();
  const waiting = new Map<number, () => void>();
  createInterface({ input: bridge.stdout }).on("line", (line) => {
    const frame = JSON.parse(line);
    answers.set(frame.id, frame.result);
    waiting.get(frame.id)?.();
  });
  const send = (id: number, name: string, args: Record<string, unknown> = {}) =>
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  const answer = (id: number) => answers.has(id) ? Promise.resolve(answers.get(id)) : new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to ${id}`)), 15_000);
    waiting.set(id, () => { clearTimeout(timer); resolve(answers.get(id)); });
  });
  const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setTimeout(resolve, 25)); };
  const close = async () => {
    bridge.stdin.end();
    bridge.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  };
  return { send, answer, answers, journal, checked, settle, close };
}

describe("a batch through the bridge", () => {
  it("makes each call as the agent's own: gated, journalled by its own name, answered once and in order", async () => {
    const run = await session();
    try {
      run.send(1, "batch", { calls: ["a", "b", "c"] });
      expect((await run.answer(1)).content[0].text).toBe("a=driver:a;b=driver:b;c=driver:c ran 3/3");
      await run.settle();
      expect(run.journal).toEqual(["a", "b", "c"]);
      expect(run.checked).toEqual(["a", "b", "c"]);
      expect([...run.answers.keys()]).toEqual([1]);
    } finally {
      await run.close();
    }
  }, 30_000);

  it("stops at the call the spec stops after, and makes none after it", async () => {
    const run = await session();
    try {
      run.send(1, "batch", { calls: ["a", "halt", "c"] });
      expect((await run.answer(1)).content[0].text).toBe("a=driver:a;halt=stop-here ran 2/3 stopped: asked to stop");
      await run.settle();
      expect(run.journal).toEqual(["a", "halt"]);
    } finally {
      await run.close();
    }
  }, 30_000);

  it("refuses a call the gate holds, with the gate's words, journals the refusal as a single call would, and never sends it", async () => {
    const run = await session();
    try {
      run.send(1, "batch", { calls: ["a", "blocked", "c"] });
      const text = (await run.answer(1)).content[0].text as string;
      expect(text).toContain("a=driver:a;blocked=The person said no.");
      expect(text).toContain("ran 2/3");
      await run.settle();
      expect(run.journal).toEqual(["a", "blocked"]);
      expect(run.checked).toEqual(["a", "blocked"]);
    } finally {
      await run.close();
    }
  }, 30_000);

  it("holds a call that arrives behind it until it has answered, so calls still act in order", async () => {
    const run = await session();
    try {
      run.send(1, "batch", { calls: ["a", "b"] });
      run.send(2, "after");
      expect((await run.answer(2)).content[0].text).toBe("driver:after");
      expect([...run.answers.keys()]).toEqual([1, 2]);
      await run.settle();
      expect(run.journal).toEqual(["a", "b", "after"]);
    } finally {
      await run.close();
    }
  }, 30_000);

  it("answers a batch that cannot be run without making a call, and without a gate check for the batch itself", async () => {
    const run = await session();
    try {
      run.send(1, "batch", { calls: [] });
      expect(await run.answer(1)).toEqual({ isError: true, content: [{ type: "text", text: "no calls" }] });
      await run.settle();
      expect(run.journal).toEqual([]);
      expect(run.checked).toEqual([]);
    } finally {
      await run.close();
    }
  }, 30_000);
});
