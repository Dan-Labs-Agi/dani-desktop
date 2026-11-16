// The fake Claude CLI in `slow` mode holds the turn behind a gate; the test drives the broker directly, as the permission proxy does. POSIX-gated.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { verificationServerEnvironment } from "../scripts/control-omb.ts";
import { BUILT_IN_INSTANCE_DRIVERS } from "../src/lib/built-in-instances.ts";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let home = "";
let base = "";
let stderr = "";
let finishGate = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const getBot = async (id: string) => (await api("GET", "/api/bots?messages=0")).body.bots.find((b: { id: string }) => b.id === id);
const threadMessages = async (threadId: string): Promise<Array<{ kind: string; card?: { requestId?: string; answered?: string } }>> =>
  (await api("GET", `/api/threads/${threadId}/messages`)).body.messages ?? [];

async function connectBroker(botId: string, threadId: string): Promise<Socket> {
  const dumpPath = join(home, "claude-turn.json");
  let socketPath = "";
  let lastCause = "no capture observed";
  try {
    await expect.poll(() => {
      try {
        const dump = z.object({
          mcpConfig: z.object({ mcpServers: z.object({ ogb: z.object({ args: z.array(z.string()) }) }) }),
        }).parse(JSON.parse(readFileSync(dumpPath, "utf8")));
        socketPath = dump.mcpConfig.mcpServers.ogb.args[1] ?? "";
        const exists = Boolean(socketPath && existsSync(socketPath));
        lastCause = exists ? "captured socket exists" : `captured socket is absent: ${socketPath}`;
        return exists;
      } catch (error) {
        lastCause = error instanceof Error ? error.message : String(error);
        return false;
      }
    }, { timeout: 20_000 }).toBe(true);
  } catch (error) {
    const state = await api("GET", "/api/bots?messages=40");
    const bot = state.body.bots.find((candidate: { id: string }) => candidate.id === botId);
    const transcript = await api("GET", `/api/threads/${threadId}/messages`);
    const events = await api("GET", `/api/threads/${threadId}/events?limit=30`);
    const engines = await api("GET", "/api/instances");
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}`
      + `\ndump exists: ${existsSync(dumpPath)}; last discovery cause: ${lastCause}`
      + `\nbot: ${JSON.stringify(bot)}`
      + `\nthread: ${JSON.stringify(transcript.body)}`
      + `\nevents: ${JSON.stringify(events.body)}`
      + `\ninstances: ${JSON.stringify(engines.body)}`
      + `\nserver stderr: ${stderr}`,
      { cause: error },
    );
  }
  const { promise, resolve, reject } = Promise.withResolvers<Socket>();
  const conn = connect(socketPath);
  conn.once("connect", () => resolve(conn));
  conn.once("error", reject);
  return promise;
}

function ask(conn: Socket, id: string, command: string): { answered: () => boolean } {
  let answered = false;
  conn.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.t === "answer" && msg.id === id) answered = true;
      } catch {
      }
    }
  });
  conn.write(JSON.stringify({ t: "ask", id, kind: "permission", tool: "Bash", input: { command } }) + "\n");
  return { answered: () => answered };
}

posixOnly("a steered message does not lift the unattended mark on its own", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-steer-unattended-"));
    const data = join(home, ".danibot");
    mkdirSync(data, { recursive: true });
    finishGate = join(home, "finish.gate");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        ...Object.fromEntries(Object.keys(BUILT_IN_INSTANCE_DRIVERS).map((id) => [
          id, { driver: "not-a-real-driver", enabled: false },
        ])),
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MODE: "slow",
            FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
            FAKE_CLAUDE_DUMP: join(home, "claude-turn.json"),
            // generateText captures have mcpConfig:null; they must not overwrite the live turn's endpoint.
            FAKE_CLAUDE_TEXT_DUMP: join(home, "claude-text.json"),
          },
          // acceptEdits: permission asks reach the broker, where a real tool call's ask would arrive.
          config: { cli: FAKE_CLAUDE, permissionMode: "acceptEdits" },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...verificationServerEnvironment({}, home, port),
        OMB_DATA_DIR: data,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }, 40_000);

  afterAll(async () => {
    writeFileSync(finishGate, "finish");
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("keeps asking after the turn POSTs into itself with no session", async () => {
    const bot = (await api("GET", "/api/bots?messages=0")).body.bots[0];
    // auto mode ON: an attended turn would sail straight through
    expect((await api("PATCH", `/api/bots/${bot.id}`, {
      autoApprove: true,
      modelSelection: { instanceId: "claude", model: "claude-fake" },
    })).status).toBe(200);
    const hook = await api("POST", "/api/webhooks", {
      name: "Nightly build",
      prompt: "Handle the incoming build event",
      botId: bot.id,
      runOn: "dani",
    });
    expect(hook.status).toBe(201);
    const delivered = await fetch(hook.body.credential.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "failed" }),
    });
    expect(delivered.status).toBe(202);
    const { runId } = (await delivered.json()) as { runId: string };

    // A webhook run works in a conversation of its own, out of the way: the turn names it when it POSTs into itself.
    let runThreadId = "";
    await expect.poll(async () => {
      const run = ((await api("GET", "/api/routines")).body.runs ?? []).find((r: { id: string }) => r.id === runId);
      runThreadId = run?.threadId ?? "";
      return Boolean(runThreadId);
    }, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await getBot(bot.id))?.busy === true && (await getBot(bot.id))?.threadId !== runThreadId, {
      timeout: 20_000,
    }).toBe(true);

    const conn = await connectBroker(bot.id, runThreadId);
    try {
      const steer = await api("POST", `/api/bots/${bot.id}/messages`, { text: "continue", threadId: runThreadId });
      expect(steer.status).toBe(202);
      expect(steer.body.steered).toBe(true);

      // An ordinary command on purpose: the destructive guard would card `rm -rf` whatever the mark said.
      const second = ask(conn, "ask-after-steer", "ls -la ./dist");
      await expect.poll(
        async () => (await threadMessages(runThreadId)).some((m) => m.kind === "options" && m.card?.requestId === "ask-after-steer"),
        { timeout: 20_000 },
      ).toBe(true);
      const card = (await threadMessages(runThreadId)).find((m) => m.card?.requestId === "ask-after-steer");
      expect(card?.card?.answered, "the steered turn auto-approved — the self-POST lifted the unattended mark").toBeUndefined();
      expect(second.answered()).toBe(false);
    } finally {
      conn.destroy();
      writeFileSync(finishGate, "finish");
      await api("POST", `/api/bots/${bot.id}/interrupt`, {}).catch(() => undefined);
    }
  }, 60_000);
});
