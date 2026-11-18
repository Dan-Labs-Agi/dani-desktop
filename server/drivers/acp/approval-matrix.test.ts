// Real provider adapters against the scripted ACP peer: proves OMB's flags and residual-request handling,
// not a native engine's classifier.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { ApprovalMode } from "../../../shared/approval-mode.ts";
import { ensureDirs } from "../../config.ts";
import type { ProviderDriver } from "../../contracts.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { recordEvents } from "../../testing/events.ts";
import type { AcpConfig } from "./core.ts";
import { CustomAcpDriver } from "./custom.ts";
import { DroidAgentDriver } from "./droid.ts";
import { GeminiAgentDriver } from "./gemini.ts";
import { HermesAgentDriver, HERMES_CONFIG_MODEL_ID } from "./hermes.ts";
import { KimiAgentDriver } from "./kimi.ts";
import { createOpenCodeDriver, openCodeOwnedDirectories } from "./opencode-go.ts";
import { QwenAgentDriver } from "./qwen.ts";

// Supply deterministic native model metadata, not a developer's credentials.
vi.mock("./hermes-model-catalog.ts", async (original) => {
  const catalog = await original<typeof import("./hermes-model-catalog.ts")>();
  return { ...catalog, buildHermesModelCatalog: (...args: Parameters<typeof catalog.buildHermesModelCatalog>) => {
    const [, ...rest] = args;
    return catalog.buildHermesModelCatalog({ providers: [{ id: "openai-codex", label: "Fixture",
      models: ["approval-fixture"], authenticatedModels: ["approval-fixture"], toolModels: ["approval-fixture"] }] }, ...rest);
  } };
});

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "../../testing/fake-acp-cli.ts");
const OpenCodeDriver = createOpenCodeDriver(async () => ({
  default: "opencode/fixture-model",
  options: [{ id: "opencode/fixture-model", label: "Fixture model" }],
}));

describe("remaining ACP approval mappings", () => {
  // A mode without an argv entry here proves the stored fullAuto: true never adds a bypass flag on its own.
  const cases: {
    driver: ProviderDriver<AcpConfig>;
    argv: string[];
    model?: string;
    native?: Partial<Record<ApprovalMode, string[]>>;
  }[] = [
    { driver: OpenCodeDriver, argv: ["acp"] },
    { driver: GeminiAgentDriver, argv: ["--acp"], native: { full: ["--yolo"] } },
    { driver: QwenAgentDriver, argv: ["--acp"], native: { full: ["--yolo"], auto: ["--approval-mode", "auto"] } },
    { driver: KimiAgentDriver, argv: ["acp"] },
    { driver: HermesAgentDriver, argv: ["acp"], model: HERMES_CONFIG_MODEL_ID },
    { driver: DroidAgentDriver, argv: ["exec", "-o", "acp"] },
    { driver: CustomAcpDriver, argv: [] },
  ];
  it.each(cases.filter(entry => process.platform !== "win32" || entry.driver !== HermesAgentDriver))("$driver.driverKind preserves residual requests across Full → Auto → Ask", async ({ driver, argv, native, model }) => {
    ensureDirs();
    const scratch = mkdtempSync(join(tmpdir(), "omb-approval-matrix-"));
    let cli = FAKE_CLI;
    if (driver === HermesAgentDriver) {
      // The supported Hermes installation contract is POSIX-only today. Windows
      // refusal is covered by the native installation tests, not a fake direct CLI.
      const bin = join(scratch, "bin");
      mkdirSync(bin);
      mkdirSync(join(scratch, ".hermes"));
      cli = join(bin, "hermes");
      writeFileSync(cli, "#!/usr/bin/env node\n", { mode: 0o700 });
      writeFileSync(join(scratch, ".hermes", "config.yaml"), "model:\n  provider: openai-codex\n  default: approval-fixture\n");
      writeFileSync(join(bin, "python3"), `#!${process.execPath}
import { createHash } from "node:crypto";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("0.21.3"); }
else if (args.includes("--runtime-info") || args.includes("--qualify-route")) {
  const runtime = { version: "0.21.3", configuredProvider: "openai-codex", resolvedProvider: "openai-codex",
    model: "approval-fixture", endpoint: "https://chatgpt.com/backend-api/codex", apiMode: "codex_responses",
    credentialFingerprint: "a".repeat(64), credentialHeaderNames: [] };
  const fields = ["version", "configuredProvider", "resolvedProvider", "model", "endpoint", "apiMode"];
  const fingerprint = createHash("sha256").update(JSON.stringify(fields.map(key => runtime[key]))).digest("hex");
  console.log(JSON.stringify(args.includes("--qualify-route") ? { schemaVersion: 1, qualified: true,
    toolCallCount: 1, resultConsumed: true, fingerprint, credentialFingerprint: runtime.credentialFingerprint } : runtime));
} else if (args[0]?.endsWith("hermes-model-metadata.py")) console.log('{"providers":[]}');
else {
  process.argv = [process.execPath, ${JSON.stringify(FAKE_CLI)}, ...args.slice(1)];
  await import(${JSON.stringify(new URL("../../testing/fake-acp-cli.ts", import.meta.url).href)});
}
`, { mode: 0o700 });
    }
    const dump = join(scratch, "spawn.json");
    const rpcDump = join(scratch, "rpc.json");
    const instance = await driver.create({
      instanceId: `approval-matrix-${driver.driverKind}`,
      displayName: "Approval fixture",
      enabled: true,
      environment: {
        HOME: scratch,
        USERPROFILE: scratch,
        HERMES_HOME: join(scratch, ".hermes"),
        KIMI_CODE_HOME: join(scratch, ".kimi"),
        DANIBOT_PROBE_LOCAL_INJECT: "0",
        FAKE_ACP_MODE: "permission",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_RPC_DUMP: rpcDump,
        OPENCODE_API_KEY: "fixture-only",
        OPENCODE_PERMISSION: '{"external_directory":"ask"}',
      },
      config: { cli, fullAuto: true },
    });
    const recorder = recordEvents(instance.adapter);
    const pidOf = () => JSON.parse(readFileSync(dump, "utf8")).pid as number;
    try {
      for (const approvalMode of ["full", "auto", "ask"] as const) {
        const pidBefore = existsSync(dump) ? pidOf() : null;
        const methodsBefore = existsSync(rpcDump) ? (JSON.parse(readFileSync(rpcDump, "utf8")) as string[]).length : 0;
        const { turnId } = await instance.adapter.sendTurn({
          threadId: "approval-matrix-thread",
          text: "Exercise one provider permission request.",
          model,
          cwd: scratch,
          approvalMode,
          ...(approvalMode === "full" ? {} : { resumeCursor: "fake-acp-session" }),
        });
        const opened = await recorder.until((event) => event.type === "request.opened" && event.turnId === turnId);
        expect(opened).toMatchObject({ requestType: "permission", tool: "shell" });
        expect(recorder.events.some((event) => event.type === "turn.completed" && event.turnId === turnId)).toBe(false);
        const respawned = pidOf() !== pidBefore;
        // A pooled child never rewrites its spawn dump: argv and env are evidence only for a real spawn.
        if (respawned) {
          expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual([...argv, ...(native?.[approvalMode] ?? [])]);
          if (driver === OpenCodeDriver) {
            const permission = JSON.parse(JSON.parse(readFileSync(dump, "utf8")).env.OPENCODE_PERMISSION);
            if (approvalMode === "full") expect(permission).toMatchObject({ "*": "allow", external_directory: "allow", read: "allow", bash: "allow", edit: "allow" });
            else expect(permission).toEqual({ external_directory: {
              "*": "ask",
              ...Object.fromEntries(openCodeOwnedDirectories().flatMap((directory) => [[directory, "allow"], [join(directory, "*"), "allow"]])),
            } });
          }
        }
        // A respawn rewrites the rpc dump and a reuse appends to it, so only methods past the baseline are this turn's.
        const methods = JSON.parse(readFileSync(rpcDump, "utf8")) as string[];
        const turnMethods = respawned ? methods : methods.slice(methodsBefore);
        if (respawned) {
          expect(turnMethods).toContain(approvalMode === "full" ? "session/new" : "session/load");
        } else {
          expect(turnMethods).toContain("session/prompt");
          expect(turnMethods).not.toContain("session/new");
          expect(turnMethods).not.toContain("session/load");
        }
        if (driver === DroidAgentDriver) {
          const settings = JSON.parse(readFileSync(`${dump}.config.json`, "utf8"));
          expect(settings[0]).toEqual({
            method: "session/set_mode",
            params: { sessionId: "fake-acp-session", modeId: approvalMode === "full" ? "auto-high" : "normal" },
          });
        }
        expect(await instance.adapter.respondToRequest("approval-matrix-thread", opened.requestId!, { behavior: "deny" }))
          .toBe("rejected");
        expect(await recorder.until((event) => event.type === "request.resolved" && event.turnId === turnId))
          .toMatchObject({ behavior: "deny", source: "user" });
        await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
      }
    } finally {
      recorder.stop();
      await instance.dispose();
      await removeTempDir(scratch);
    }
  });
});
