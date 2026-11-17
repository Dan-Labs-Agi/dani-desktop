import { runMcpBridge } from "../../server/mcp-bridge.ts";

const [command, ...args] = process.argv.slice(2);

runMcpBridge({
  command: command!,
  args,
  label: "Fixture Driver",
  relay: (call) => {
    if (call.name === "throws_now") throw new Error("a stage broke before it returned");
    if (call.name === "rejects_later") return Promise.reject(new Error("a stage broke after it returned"));
    return null;
  },
});
