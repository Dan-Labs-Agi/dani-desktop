import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as ConfigModule from "../config.ts";
import type * as ProcsModule from "../procs.ts";

const fixture = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock("../config.ts", async (importOriginal) => {
  // Hoisted mock factories run before this file's static imports initialize.
  const original = await importOriginal<typeof ConfigModule>();
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { ...original, DATA_DIR: mkdtempSync(join(tmpdir(), "dani-free-errors-test-")) };
});
vi.mock("../procs.ts", async (importOriginal) => {
  const original = await importOriginal<typeof ProcsModule>();
  return { ...original, spawnCli: ((cli, args, options, owner) => original.spawnCli(cli, args,
    { ...options, env: { ...options.env, ...fixture.env } }, owner)) satisfies typeof original.spawnCli };
});
vi.mock("./native.ts", () => ({ appendNative: vi.fn() }));

import { DATA_DIR } from "../config.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { recordEvents } from "../testing/events.ts";
import { createOpenCodeDriver, openCodeLogPath } from "./acp/opencode-go.ts";
import * as quietStatus from "./acp/quiet-status.ts";
import { activateDaniFree } from "./dani-free-catalog.ts";

const FAKE_CLI = fileURLToPath(new URL("../testing/fake-acp-cli.ts", import.meta.url));
const rawRemediation = /OpenCode|Kilo|subscribe|subscription|add credit|API key|auth login|upgrade/iu;
const freeRow = { id: "selected", name: "Selected", type: "chat", modalities: { input: ["text"], output: ["text"] },
  cost: { text: { input: { price: 0 }, output: { price: 0 } } }, capabilities: { tools: { supported: true } } };

const open = async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [freeRow] })));
  activateDaniFree();
  const driver = createOpenCodeDriver(async () => ({ default: "opencode/selected", options: [{ id: "opencode/selected", label: "Selected" }] }));
  const workspace = join(DATA_DIR, "workspace");
  mkdirSync(workspace, { recursive: true });
  const instance = await driver.create({ instanceId: "free-refusal", displayName: "Dani", enabled: true,
    config: driver.decodeConfig({ freeOnly: true, cli: FAKE_CLI, workspace }), environment: {} });
  await instance.startupModelRefresh;
  const recorder = recordEvents(instance.adapter);
  return { instance, recorder, run: async () => {
    const { turnId } = await instance.adapter.sendTurn({ threadId: "free-refusal-thread", text: "synthetic prompt", model: "opencode/selected" });
    const done = await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    return { done, events: recorder.events.filter((event) => event.turnId === turnId) };
  } };
};

afterEach(() => {
  fixture.env = {};
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(join(DATA_DIR, "providers", "dani-free"), { recursive: true, force: true });
});
afterAll(() => removeTempDir(DATA_DIR));

describe("Dani ordinary free chat refusal presentation", () => {
  it.each([
    ["quota", "Free usage limit reached. Subscribe to OpenCode Go.", /usage limit/iu],
    ["balance", "Insufficient balance. Add credit at opencode.ai.", /refused/iu],
    ["subscription", "An active OpenCode Go subscription is required.", /refused/iu],
    ["credentials", "Invalid API key. Run opencode auth login.", /refused/iu],
  ])("keeps %s refusal visible without vendor or paid account remediation", async (_kind, message, expected) => {
    const failure = join(DATA_DIR, "failure.json");
    writeFileSync(failure, JSON.stringify({ code: -32603, message, data: { service: "session", errorName: "APIError" } }));
    fixture.env = { FAKE_ACP_MODELS: "opencode/selected", FAKE_ACP_RPC_FAILURE_FILE: failure };
    const f = await open();
    try {
      const { done, events } = await f.run();
      expect(done).toMatchObject({ ok: false });
      const error = events.find((event) => event.type === "runtime.error");
      expect(error).toMatchObject({ message: expect.stringMatching(expected) });
      if (_kind === "quota") expect(error).toMatchObject({ limit: "engine" });
      expect(error?.type === "runtime.error" ? error.message : "missing error").not.toMatch(rawRemediation);
      expect(JSON.stringify(events.filter((event) => event.type === "session.started"))).toContain("opencode/selected");
    } finally {
      f.recorder.stop();
      await f.instance.dispose();
    }
  });

  it.each([
    ["quota", "Free usage limit reached. Subscribe to OpenCode Go.", /Dani free model usage limit/iu],
    ["refusal", "Payment required. Add credit at OpenCode.", /free model service refused/iu],
  ])("presents only session-matched free %s log notices and retains raw diagnostic logs", async (_kind, refusal, expected) => {
    vi.spyOn(quietStatus, "sampleProcessTree").mockResolvedValue({ cpuMs: 0, connections: 1 });
    vi.stubEnv("OMB_ACP_QUIET_NOTICE_MS", "200");
    vi.stubEnv("OMB_ACP_QUIET_TICK_MS", "50");
    const row = (session: string, small: boolean, message: string) =>
      `level=ERROR session.id=${session} small=${small} error.error="AI_APICallError: ${message}"`;
    fixture.env = { FAKE_ACP_MODELS: "opencode/selected", FAKE_ACP_MODE: "quiet-then-answer", FAKE_ACP_QUIET_MS: "1200",
      FAKE_ACP_OPENCODE_LOG: JSON.stringify([
        row("ses_other", false, "Other session refused. Add credit at OpenCode."),
        row("{session}", true, "Title model refused. Add an API key."),
        row("{session}", false, refusal),
      ]) };
    const f = await open();
    try {
      const { events } = await f.run();
      const messages = events.flatMap((event) => event.type === "runtime.notice" || event.type === "runtime.error" ? [event.message] : []);
      expect(messages).toContainEqual(expect.stringMatching(expected));
      expect(messages.join("\n")).not.toMatch(rawRemediation);
      expect(messages.join("\n")).not.toMatch(/other session|title model/iu);
      const root = join(DATA_DIR, "providers", "dani-free", "clients", "instance-free-refusal");
      const logPath = openCodeLogPath({ XDG_DATA_HOME: join(root, "data") });
      expect(readFileSync(logPath, "utf8")).toContain(refusal);
    } finally {
      f.recorder.stop();
      await f.instance.dispose();
    }
  });
});
