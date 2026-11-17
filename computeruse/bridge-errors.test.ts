import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RELAY = fileURLToPath(new URL("./testing/throwing-relay.ts", import.meta.url));

// A disposable MCP child: it answers every tools/call with what it was asked and touches nothing.
const DRIVER = `
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "driver:" + message.params.name }] } }) + "\\n");
});
`;

async function ask(names: string[]): Promise<Record<string, any>> {
  const folder = mkdtempSync(join(tmpdir(), "computeruse-bridge-"));
  const driver = join(folder, "driver.cjs");
  writeFileSync(driver, DRIVER);
  const bridge = spawn(process.execPath, ["--experimental-strip-types", RELAY, process.execPath, driver], { stdio: ["pipe", "pipe", "inherit"] });
  const answers: Record<string, any> = {};
  const lines = createInterface({ input: bridge.stdout });
  const done = new Promise<void>((resolve) => lines.on("line", (line) => {
    const frame = JSON.parse(line);
    answers[String(frame.id)] = frame.result;
    if (Object.keys(answers).length === names.length) resolve();
  }));
  names.forEach((name, index) => bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name, arguments: {} } }) + "\n"));
  const timer = setTimeout(() => bridge.kill(), 15_000);
  try {
    await done;
  } finally {
    clearTimeout(timer);
    bridge.stdin.end();
    bridge.kill();
    rmSync(folder, { recursive: true, force: true });
  }
  return answers;
}

describe("a relay that fails", () => {
  it("still answers the agent, in a result it can read, whether it throws at once or later", async () => {
    const answers = await ask(["throws_now", "rejects_later", "plain"]);
    expect(answers["1"]).toMatchObject({ isError: true, content: [{ type: "text", text: "a stage broke before it returned" }] });
    expect(answers["2"]).toMatchObject({ isError: true, content: [{ type: "text", text: "a stage broke after it returned" }] });
    expect(answers["3"]).toMatchObject({ content: [{ type: "text", text: "driver:plain" }] });
  }, 30_000);
});
