// The fake desktop behind MCP stdio, standing where cua-driver does. The desktop it serves comes from the file named in
// BENCH_DESKTOP; `__snapshot` hands the benchmark what the world holds, and is not a tool any agent is told about.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createDesktop } from "./desktop.ts";

const { spec, seed } = JSON.parse(readFileSync(process.env.BENCH_DESKTOP ?? "", "utf8"));
const desktop = createDesktop(spec, seed);

const target = { pid: { type: "integer" }, window_id: { type: "integer" }, element_index: { type: "integer" }, element_token: { type: "string" }, x: { type: "number" }, y: { type: "number" } };
const window = { pid: { type: "integer" }, window_id: { type: "integer" } };
const SCHEMAS: Record<string, Record<string, unknown>> = {
  get_window_state: window, list_windows: {}, list_apps: {}, launch_app: { name: { type: "string" } },
  click: target, double_click: target, right_click: target,
  set_value: { ...target, value: { type: "string" } }, type_text: { ...target, text: { type: "string" } },
  scroll: { ...window, direction: { type: "string", enum: ["up", "down"] }, amount: { type: "integer" } },
  press_key: { ...window, key: { type: "string" } }, hotkey: { ...window, keys: { type: "array", items: { type: "string" } } },
  set_agent_cursor_enabled: { enabled: { type: "boolean" } }, set_agent_cursor_motion: { glide_duration_ms: { type: "number" } },
};
const TOOLS = Object.keys(SCHEMAS);
const schemaOf = (name: string) => ({ type: "object", properties: SCHEMAS[name], additionalProperties: true });

const write = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    return write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "bench-driver", version: "0.28.2" } } });
  }
  if (message.method === "tools/list") {
    return write({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS.map((name) => ({ name, description: `${name} on the fixture desktop`, inputSchema: schemaOf(name) })) } });
  }
  if (message.method !== "tools/call" || typeof message.params?.name !== "string") return write({ jsonrpc: "2.0", id: message.id, result: {} });
  const { name, arguments: args = {} } = message.params;
  if (name === "__snapshot") {
    const world = desktop.snapshot();
    return write({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "snapshot" }], structuredContent: { ...world, packages: [...world.packages] } } });
  }
  write({ jsonrpc: "2.0", id: message.id, result: desktop.handle(name, args) });
});
