// The fake desktop behind MCP stdio, standing where cua-driver does. The desktop it serves comes from the file named in
// BENCH_DESKTOP; `__snapshot` hands the benchmark what the world holds, and is not a tool any agent is told about.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createDesktop } from "./desktop.ts";

const { spec, seed } = JSON.parse(readFileSync(process.env.BENCH_DESKTOP ?? "", "utf8"));
const desktop = createDesktop(spec, seed);

const TOOLS = ["get_window_state", "list_windows", "list_apps", "launch_app", "click", "double_click", "right_click", "set_value", "type_text",
  "scroll", "press_key", "hotkey", "set_agent_cursor_enabled", "set_agent_cursor_motion"];
const schema = { type: "object", properties: {}, additionalProperties: true };

const write = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    return write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "bench-driver", version: "0.28.2" } } });
  }
  if (message.method === "tools/list") {
    return write({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS.map((name) => ({ name, description: `${name} on the fixture desktop`, inputSchema: schema })) } });
  }
  if (message.method !== "tools/call" || typeof message.params?.name !== "string") return write({ jsonrpc: "2.0", id: message.id, result: {} });
  const { name, arguments: args = {} } = message.params;
  if (name === "__snapshot") {
    const world = desktop.snapshot();
    return write({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "snapshot" }], structuredContent: { ...world, packages: [...world.packages] } } });
  }
  write({ jsonrpc: "2.0", id: message.id, result: desktop.handle(name, args) });
});
