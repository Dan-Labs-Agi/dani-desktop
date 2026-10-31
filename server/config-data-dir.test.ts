import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const saved = { dani: process.env.DANI_DATA_DIR, omb: process.env.OMB_DATA_DIR };
afterEach(() => {
  for (const [key, value] of [["DANI_DATA_DIR", saved.dani], ["OMB_DATA_DIR", saved.omb]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  vi.resetModules();
});

async function dataDir(): Promise<string> {
  vi.resetModules();
  return (await import("./config.ts")).DATA_DIR;
}

describe("server data dir", () => {
  it("defaults to ~/.danibot", async () => {
    delete process.env.DANI_DATA_DIR; delete process.env.OMB_DATA_DIR;
    expect(await dataDir()).toBe(join(homedir(), ".danibot"));
  });
  it("lets DANI_DATA_DIR win over the upstream OMB_DATA_DIR, and honors OMB_DATA_DIR alone", async () => {
    process.env.DANI_DATA_DIR = "/tmp/dani-a"; process.env.OMB_DATA_DIR = "/tmp/omb-b";
    expect(await dataDir()).toBe("/tmp/dani-a");
    delete process.env.DANI_DATA_DIR;
    expect(await dataDir()).toBe("/tmp/omb-b");
  });
});
