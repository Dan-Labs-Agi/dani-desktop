import { runMcpBridge } from "../../server/mcp-bridge.ts";

const [command, ...args] = process.argv.slice(2);
const texts = (result: Record<string, unknown>) => (Array.isArray(result.content) ? result.content : []).map((part) => String((part as { text?: unknown }).text ?? ""));

// A bridge with a gate, a journal and a batch tool that stops at an error or when a call's answer says "stop-here".
runMcpBridge({
  command: command!,
  args,
  label: "Fixture Driver",
  gate: { url: process.env.TEST_CONTROL!, token: "t", describe: (frame) => ({ tool: String((frame as { params?: { name?: unknown } }).params?.name) }) },
  journal: { url: process.env.TEST_JOURNAL!, token: "t" },
  batch: {
    name: "batch",
    plan: (given) => Array.isArray(given.calls) && given.calls.length
      ? { calls: given.calls.map((name) => ({ name: String(name), arguments: {} })) }
      : { error: "no calls" },
    stopAfter: (_call, result) => (result.isError === true ? "refused" : texts(result).some((text) => text.includes("stop-here")) ? "asked to stop" : null),
    answer: (done, planned, stopped) => ({ content: [{ type: "text", text: `${done.map(({ call, result }) => `${call.name}=${texts(result).join("|")}`).join(";")} ran ${done.length}/${planned}${stopped ? ` stopped: ${stopped}` : ""}` }] }),
  },
});
