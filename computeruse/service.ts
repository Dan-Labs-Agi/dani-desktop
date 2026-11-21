// The descriptor and turn token travel in environment variables, never argv or logs.
import { runMcpBridge } from "../server/mcp-bridge.ts";
import { augmentedPath } from "../server/env-path.ts";
import { createEvidenceReporter, evidenceUrl, postEvidence } from "./evidence.ts";
import { guardsFromEnv } from "./guards.ts";
import { COMPUTER_BATCH } from "./batch-tool.ts";
import { READ_WINDOW_ALIAS } from "./read-window-tool.ts";
import { localComputerCallQuery, localComputerRelay, localComputerResultLine } from "./guidance.ts";
import { journalUrl } from "../server/saved-steps/journal-tap.ts";

const {
  OMB_CUA_COMMAND: command,
  OMB_CUA_ARGS: encodedArgs,
  OMB_CUA_PLATFORM: platform,
  OMB_CONTROL_URL: url,
  OMB_CONTROL_TOKEN: token,
  OMB_COMPUTER_JOURNAL: journal,
  OMB_COMPUTER_VERIFY: verifyEffects,
  ...environment
} = process.env;
const { guards, rest: childEnv } = guardsFromEnv(environment);

let args: string[];
try {
  const parsed: unknown = JSON.parse(encodedArgs ?? "");
  const endpoint = new URL(url ?? "");
  if (!command?.trim() || command.includes("\0") ||
      !Array.isArray(parsed) || !parsed.every((arg) => typeof arg === "string" && !arg.includes("\0")) ||
      !token || !["http:", "https:"].includes(endpoint.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password) {
    throw new Error("invalid connection");
  }
  args = parsed;
} catch {
  process.stderr.write("invalid local computer proxy connection\n");
  process.exit(2);
}

// Without a verdict for each action there is nothing for a batch to stop on, so it is offered only with both checks that give one.
const batching = guards.batch === true && guards.evidence === true && verifyEffects === "1";
const pipeline = localComputerRelay(platform ?? process.platform, verifyEffects === "1", guards);
const reporter = guards.evidence
  ? createEvidenceReporter({ post: postEvidence(evidenceUrl(url!), token!), counters: pipeline.counters })
  : null;
// The service can outlive its turn or not, so totals go out as actions finish; this only catches the last one.
if (reporter) process.once("beforeExit", () => void reporter.flush());

runMcpBridge({
  command: command!,
  args,
  env: { ...childEnv, PATH: augmentedPath() },
  label: "Local Cua Driver",
  gate: { url: url!, token: token!, describe: (frame) => ({ ...localComputerCallQuery(frame), ...pipeline.describe(frame) }) },
  ...(journal === "1" ? { journal: { url: journalUrl(url!), token: token! } } : {}),
  rewriteResponse: (line) => localComputerResultLine(line, guards.untrusted === true, guards.guidance === true, guards.readWindow === true, batching),
  ...(batching ? { batch: COMPUTER_BATCH } : {}),
  ...(guards.readWindow ? { alias: READ_WINDOW_ALIAS } : {}),
  relay: (call, child) => {
    const answer = pipeline(call, child);
    return answer && reporter ? answer.finally(() => reporter.note()) : answer;
  },
});
