import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../bench/live/run.ts";
import type { ChatModel } from "../../../bench/live/model.ts";

const folders: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const io = () => {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line), error: (line: string) => void lines.push(line) };
};
const out = () => { const folder = mkdtempSync(join(tmpdir(), "live-bench-")); folders.push(folder); return folder; };
const counting = (tokens = 50): ChatModel & { asked: number } => {
  const self = { asked: 0, async complete() { self.asked += 1; return { text: "I cannot do that.", calls: [], usage: { inputTokens: tokens, outputTokens: 5 } }; } };
  return self;
};

describe("the live tier's guard against spending", () => {
  it("says how to use it when it is not told which model", async () => {
    const log = io();
    expect(await main([], {}, log)).toBe(2);
    expect(log.lines.join("\n")).toContain("Usage:");
  });

  it("does not call a model without --yes-spend, and shows what it would do", async () => {
    const model = counting();
    const log = io();
    expect(await main(["--model", "m", "--task", "change-setting"], {}, log, model)).toBe(2);
    expect(model.asked).toBe(0);
    expect(log.lines.join("\n")).toContain("Pass --yes-spend");
    expect(log.lines.join("\n")).toContain("1 tasks x 2 profile(s) x 3 run(s) = 6 attempts");
  });

  it("plans with --dry and calls nothing, with the most it could cost when given prices", async () => {
    const model = counting();
    const log = io();
    expect(await main(["--model", "m", "--dry", "--max-tokens", "1000000", "--price-in", "3", "--price-out", "15"], {}, log, model)).toBe(0);
    expect(model.asked).toBe(0);
    expect(log.lines.join("\n")).toContain("16 tasks x 2 profile(s) x 3 run(s) = 96 attempts");
    expect(log.lines.join("\n")).toContain("$15.00");
  });

  it("needs an endpoint and a key from the environment when no model was given to it", async () => {
    const log = io();
    expect(await main(["--model", "m", "--yes-spend"], {}, log)).toBe(2);
    expect(log.lines.join("\n")).toContain("COMPUTER_BENCH_API_KEY");
  });

  it("refuses numbers that are not whole and a task a model cannot run", async () => {
    const log = io();
    expect(await main(["--model", "m", "--runs", "0"], {}, log)).toBe(2);
    expect(await main(["--model", "m", "--max-tokens", "lots"], {}, log)).toBe(2);
    expect(await main(["--model", "m", "--task", "repeated-unchanged-action", "--dry"], {}, log)).toBe(2);
    expect(await main(["--model", "m", "--task", "nope", "--dry"], {}, log)).toBe(2);
    expect(await main(["--model", "m", "--profile", "both-ish", "--dry"], {}, log)).toBe(2);
  });
});

describe("a live run", () => {
  it("runs each task under each profile, writes a report that says what it is not, and exits non-zero when a task failed", async () => {
    const folder = out();
    const model = counting();
    const code = await main(["--model", "Fixture/Model 1", "--yes-spend", "--task", "change-setting", "--runs", "2", "--out", folder, "--price-in", "1", "--price-out", "2"], {}, io(), model);
    expect(code).toBe(1);
    expect(model.asked).toBe(4);
    const names = readdirSync(folder).sort();
    expect(names).toEqual(["live-fixture-model-1.json", "live-fixture-model-1.md"]);
    const report = JSON.parse(readFileSync(join(folder, names[0]!), "utf8"));
    expect(report).toMatchObject({ model: "Fixture/Model 1", runsPerTask: 2, incomplete: false, tokensUsed: 220 });
    expect(report.attempts.map((attempt: { profile: string; run: number }) => `${attempt.profile}${attempt.run}`)).toEqual(["baseline1", "checked1", "baseline2", "checked2"]);
    expect(report.estimatedCost.dollars).toBeCloseTo((200 * 1 + 20 * 2) / 1e6);
    const text = readFileSync(join(folder, names[1]!), "utf8");
    expect(text).toContain("must not be quoted as one");
    expect(text).toContain("| change-setting | 0/2 | 0/2 |");
  }, 60_000);

  it("stops at the token limit, says so in the report, and does not start another attempt", async () => {
    const folder = out();
    const model = counting(100);
    const code = await main(["--model", "m", "--yes-spend", "--task", "change-setting", "--runs", "5", "--max-tokens", "250", "--out", folder], {}, io(), model);
    expect(code).toBe(1);
    expect(model.asked).toBe(3);
    const report = JSON.parse(readFileSync(join(folder, "live-m.json"), "utf8"));
    expect(report.incomplete).toBe(true);
    expect(report.attempts).toHaveLength(3);
    expect(readFileSync(join(folder, "live-m.md"), "utf8")).toContain("STOPPED EARLY");
  }, 60_000);

  it("talks to the endpoint it was given, keeps the key and path out of the report, and records the host", async () => {
    const folder = out();
    const key = "report-leak-canary-77";
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "No." } }], usage: { prompt_tokens: 10, completion_tokens: 1 } }));
      });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/secret-path/v1`;
    await main(["--model", "m", "--yes-spend", "--task", "change-setting", "--runs", "1", "--out", folder], { COMPUTER_BENCH_API_URL: url, COMPUTER_BENCH_API_KEY: key }, io());
    expect(authorization).toBe(`Bearer ${key}`);
    const json = readFileSync(join(folder, "live-m.json"), "utf8");
    const written = json + readFileSync(join(folder, "live-m.md"), "utf8");
    expect(written).not.toContain(key);
    expect(written).not.toContain("secret-path");
    expect(JSON.parse(json).endpointHost).toBe(new URL(url).host);
  }, 60_000);
});
