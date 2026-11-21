// Runs the task pack with a real model in place of the scripted agent. This spends money, so it does nothing unless told to
// with --yes-spend, stops at a token limit it was given, and is never part of CI. Every number it writes is one model on a
// fake desktop; none is a success rate.
//   COMPUTER_BENCH_API_URL, COMPUTER_BENCH_API_KEY: an OpenAI-compatible endpoint and its key (the key is read from here only)
//   node --experimental-strip-types computeruse/bench/live/run.ts --model <name> [--dry] [--yes-spend] [--runs 3]
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPack } from "../pack.ts";
import { PROFILES, runFixtureTask } from "../world.ts";
import { runModelAgent, TokenBudget } from "./agent.ts";
import { assertEndpoint, type ChatModel, openAiChatModel } from "./model.ts";
import { type LiveReport, type LiveRunResult, renderLiveReport, writeLiveReport } from "./report.ts";

const BENCH = fileURLToPath(new URL("../", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const DEFAULTS = { runs: 3, maxTokens: 400_000, taskTokens: 40_000, maxSteps: 25, timeoutMs: 180_000, maxOutputTokens: 1_024 };

const USAGE = `Usage: run.ts --model <name> [--yes-spend | --dry] [--task <id>] [--runs ${DEFAULTS.runs}] [--profile both|baseline|checked]
  [--max-tokens ${DEFAULTS.maxTokens}] [--task-tokens ${DEFAULTS.taskTokens}] [--max-steps ${DEFAULTS.maxSteps}] [--timeout-ms ${DEFAULTS.timeoutMs}]
  [--price-in <dollars per million>] [--price-out <dollars per million>] [--out <folder>]
Needs COMPUTER_BENCH_API_URL and COMPUTER_BENCH_API_KEY in the environment.`;

export interface Io { log(line: string): void; error(line: string): void }

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function whole(argv: readonly string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a whole number of at least 1.`);
  return value;
}

function price(argv: readonly string[], name: string): number | undefined {
  const raw = flag(argv, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a price in dollars per million tokens.`);
  return value;
}

/** Returns the exit code: 0 done, 1 done but stopped early or a task did not pass, 2 not run. */
export async function main(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: Io = console, injected?: ChatModel): Promise<number> {
  try {
    const modelName = flag(argv, "model");
    if (!modelName) { io.error(USAGE); return 2; }
    const runs = whole(argv, "runs", DEFAULTS.runs);
    const limits = { maxTokens: whole(argv, "max-tokens", DEFAULTS.maxTokens), taskTokens: whole(argv, "task-tokens", DEFAULTS.taskTokens),
      maxSteps: whole(argv, "max-steps", DEFAULTS.maxSteps), timeoutMs: whole(argv, "timeout-ms", DEFAULTS.timeoutMs) };
    const profileFlag = flag(argv, "profile") ?? "both";
    if (!["both", "baseline", "checked"].includes(profileFlag)) { io.error("--profile is both, baseline or checked."); return 2; }
    const profiles = profileFlag === "both" ? (["baseline", "checked"] as const) : ([profileFlag] as ["baseline" | "checked"]);
    const only = flag(argv, "task");
    const pack = loadPack(BENCH);
    const tasks = pack.tasks.map((entry) => entry.task).filter((task) => task.ask !== undefined && (only === undefined || task.id === only));
    if (tasks.length === 0) { io.error(only ? `No task called ${only} that a model can run.` : "No task has an ask."); return 2; }
    const inPrice = price(argv, "price-in");
    const outPrice = price(argv, "price-out");
    const attemptsPlanned = tasks.length * profiles.length * runs;

    io.log(`Model ${modelName}: ${tasks.length} tasks x ${profiles.length} profile(s) x ${runs} run(s) = ${attemptsPlanned} attempts.`);
    io.log(`Limits: ${limits.maxTokens} tokens in all, ${limits.taskTokens} per attempt, ${limits.maxSteps} steps, ${limits.timeoutMs} ms.`);
    if (inPrice !== undefined && outPrice !== undefined) io.log(`Most it can cost at those prices: $${((limits.maxTokens * Math.max(inPrice, outPrice)) / 1e6).toFixed(2)}, plus at most one request past the limit.`);
    else io.log("Pass --price-in and --price-out to see the most it can cost.");
    if (argv.includes("--dry")) { io.log("Dry run: nothing was sent."); return 0; }
    if (!argv.includes("--yes-spend")) { io.error("This calls a paid model. Pass --yes-spend to run it, or --dry to see the plan only."); return 2; }

    let model = injected;
    let endpointHost = "injected";
    if (!model) {
      const url = env.COMPUTER_BENCH_API_URL;
      const apiKey = env.COMPUTER_BENCH_API_KEY;
      if (!url || !apiKey) { io.error("Set COMPUTER_BENCH_API_URL and COMPUTER_BENCH_API_KEY."); return 2; }
      endpointHost = assertEndpoint(url).host;
      model = openAiChatModel({ url, apiKey, model: modelName, maxOutputTokens: DEFAULTS.maxOutputTokens });
    }

    const budget = new TokenBudget(limits.maxTokens);
    const agent = runModelAgent({ model, budget, taskTokens: limits.taskTokens, maxSteps: limits.maxSteps });
    const attempts: LiveRunResult[] = [];
    let incomplete = false;
    planned: for (let run = 1; run <= runs; run += 1) {
      for (const task of tasks) {
        for (const profile of profiles) {
          if (budget.exhausted) { incomplete = true; break planned; }
          const taskRun = await runFixtureTask(task, PROFILES[profile]!, { agent, timeoutMs: limits.timeoutMs });
          attempts.push({ profile, run, result: taskRun.result, ...(taskRun.note ? { note: taskRun.note } : {}) });
          io.log(`${profile.padEnd(8)} run ${run} ${taskRun.result.passed ? "PASS" : "FAIL"} ${task.id} (${taskRun.result.usage?.requests ?? 0} requests)`);
        }
      }
    }

    const report: LiveReport = {
      model: modelName, endpointHost, generatedAt: new Date().toISOString(), runsPerTask: runs, attempts, incomplete,
      tokenLimit: limits.maxTokens, tokensUsed: budget.used,
      ...(inPrice !== undefined && outPrice !== undefined ? { estimatedCost: {
        dollars: (attempts.reduce((sum, attempt) => sum + (attempt.result.usage?.inputTokens ?? 0), 0) * inPrice
          + attempts.reduce((sum, attempt) => sum + (attempt.result.usage?.outputTokens ?? 0), 0) * outPrice) / 1e6,
        inputPerMillion: inPrice, outputPerMillion: outPrice } } : {}),
    };
    const slug = modelName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "model";
    const files = writeLiveReport(flag(argv, "out") ?? `${ROOT}evals/reports/computer`, `live-${slug}`, report);
    io.log(renderLiveReport(report));
    io.log(`Report: ${files.markdown}`);
    return incomplete || attempts.some((attempt) => !attempt.result.passed) ? 1 : 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2), process.env));
