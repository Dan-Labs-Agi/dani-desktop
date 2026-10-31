// Dani Free: the bundled keyless proxy (server/dani-free.ts) as a built-in provider. One instance,
// one visible model - the proxy's own routing model, shown exactly as "Dani Free Auto". The upstream
// services behind it change with what the proxy finds; their names never reach the interface.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { DATA_DIR } from "../config.ts";
import {
  bundledDaniFreeExecutable, DANI_AUTO_MODEL, DANI_AUTO_MODEL_NAME, DaniFreeSupervisor, type DaniFreeSource,
} from "../dani-free.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

const DRIVER_KIND = "daniFree";
const IDLE_TIMEOUT_MS = 180_000;

export const DANI_FREE_CATALOG: ModelCatalog = {
  default: DANI_AUTO_MODEL,
  options: [{ id: DANI_AUTO_MODEL, label: DANI_AUTO_MODEL_NAME }],
};

export interface DaniFreeConfig {
  /** Honest off switch for the bundled proxy; the instance stays listed, unavailable. */
  disabled?: boolean;
}

function decodeConfig(raw: unknown): DaniFreeConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.disabled !== undefined && typeof config.disabled !== "boolean") throw new Error("disabled must be a boolean");
  return { disabled: config.disabled === true };
}

/** Where the staged binary lives: explicit override, packaged resources, then the repo's resources/. */
function executableCandidates(): string[] {
  const roots = [
    ...(process.env.DANI_FREE_EXECUTABLE ? [null] : []),
    ...((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ? [(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!] : []),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "resources"),
  ];
  if (process.env.DANI_FREE_EXECUTABLE) {
    return existsSync(process.env.DANI_FREE_EXECUTABLE) ? [process.env.DANI_FREE_EXECUTABLE] : [];
  }
  return roots
    .filter((root): root is string => Boolean(root))
    .map((root) => bundledDaniFreeExecutable(root))
    .filter((path): path is string => Boolean(path));
}

/** Test seam: lets a test run the real driver against a stub process on any OS. Unset in production. */
export const daniFreeDriverSeams: { spawnProcess?: typeof import("node:child_process").spawn } = {};

export const DaniFreeDriver: ProviderDriver<DaniFreeConfig> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Dani Free",
    supportsMultipleInstances: false,
  },
  models: DANI_FREE_CATALOG,
  decodeConfig,
  defaultConfig: () => ({}),

  async create(input) {
    const { config } = input;
    // An instance always resolves: a proxy that is missing or will not start becomes an honest
    // unavailable provider, never a fleet failure.
    let unavailable: string | null = null;
    let supervisor: DaniFreeSupervisor | null = null;
    let source: DaniFreeSource | null = null;
    if (config.disabled) {
      unavailable = "Dani Free is switched off in this instance's config.";
    } else {
      const executable = executableCandidates()[0];
      if (!executable) {
        unavailable = "The Dani Free proxy is not bundled in this build.";
      } else {
        supervisor = new DaniFreeSupervisor({
          executable,
          home: join(DATA_DIR, "dani-free"),
          ...(daniFreeDriverSeams.spawnProcess ? { spawnProcess: daniFreeDriverSeams.spawnProcess } : {}),
        });
        source = await supervisor.start();
        if (!source) unavailable = "Dani Free did not start; the app keeps its other providers.";
      }
    }
    const runtime = createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey: source?.apiKey ?? "",
      apiUrl: source?.baseUrl ?? "http://127.0.0.1:1/v1",
      tools: true,
      computerUse: true,
      nudgeAnnouncedAction: true,
      models: () => DANI_FREE_CATALOG,
      requestBody: (model, messages, stream) => ({
        model,
        messages,
        stream,
        stream_options: stream ? { include_usage: true } : undefined,
      }),
      httpErrorLabel: "Dani Free",
      missingKeyError: unavailable ?? "Dani Free is not running.",
      unavailableReason: unavailable ?? "Dani Free is not running.",
      timeoutMs: IDLE_TIMEOUT_MS,
      reasoning: true,
      includeUsageInCompleted: false,
      nativeLog: {
        source: "dani-free.chat.completions",
        outgoing: (_turn, messages, model, tools) => ({ model, messageCount: messages.length, tools: tools.map((tool) => tool.function.name) }),
        incoming: ({ text, reasoning }) => ({ textLength: text.length, reasoningLength: reasoning.length }),
      },
    });
    return {
      ...runtime,
      dispose: async () => {
        await runtime.dispose().catch(() => undefined);
        await supervisor?.stop();
      },
    };
  },
};
