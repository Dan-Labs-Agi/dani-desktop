import { afterEach, describe, expect, it, vi } from "vitest";
import * as secureStorage from "./secure-credentials.mjs";
import { createSecureCredentialState } from "./secure-credential-state.mjs";

const { readSecureCredentials } = secureStorage;
afterEach(() => vi.useRealTimers());

const transient = () =>
  new Error("safeStorage.decryptStringAsync is temporarily unavailable. Please try again.");

const deps = (over = {}) => ({
  exists: () => true,
  isAvailable: async () => true,
  readFile: () => Buffer.from("cipher"),
  decrypt: async () => JSON.stringify({ composioApiKey: "ak_live" }),
  sleep: async () => {},
  ...over,
});

describe("readSecureCredentials", () => {
  it("reports an empty store when no file was ever written", async () => {
    const result = await readSecureCredentials(deps({ exists: () => false }));
    expect(result).toEqual({ status: "empty", credentials: {} });
  });

  it("returns the stored credentials when the store opens", async () => {
    const result = await readSecureCredentials(deps());
    expect(result.status).toBe("ok");
    expect(result.credentials).toEqual({ composioApiKey: "ak_live" });
  });

  it("tries again when the OS says the store is temporarily unavailable", async () => {
    const decrypt = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValue(JSON.stringify({ composioApiKey: "ak_live" }));
    const result = await readSecureCredentials(deps({ decrypt }));
    expect(decrypt).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("ok");
    expect(result.credentials).toEqual({ composioApiKey: "ak_live" });
  });

  it("waits between attempts instead of hammering the keychain", async () => {
    const slept = [];
    const decrypt = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue("{}");
    await readSecureCredentials(deps({ decrypt, sleep: async (ms) => slept.push(ms) }));
    expect(slept).toEqual([100]);
  });

  it("says UNAVAILABLE — never empty — when every attempt fails", async () => {
    const decrypt = vi.fn().mockRejectedValue(transient());
    const result = await readSecureCredentials(deps({ decrypt }));
    expect(result.status).toBe("unavailable");
    expect(result.credentials).toEqual({});
    expect(result.error).toMatch(/temporarily unavailable/);
    expect(decrypt.mock.calls.length).toBeGreaterThan(1);
  });

  it("says UNAVAILABLE when the OS store itself is switched off", async () => {
    const result = await readSecureCredentials(deps({ isAvailable: async () => false }));
    expect(result.status).toBe("unavailable");
  });

  it("says UNAVAILABLE for a file it cannot parse, rather than pretending it is empty", async () => {
    const decrypt = vi.fn().mockResolvedValue("not json");
    const result = await readSecureCredentials(deps({ decrypt }));
    expect(result.status).toBe("unavailable");
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});

describe("secure-storage deadlines", () => {
  it.each(["availability", "decryption"])("keeps existing credentials unavailable when OS %s never answers", async (stage) => {
    vi.useFakeTimers();
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    let result;
    const pending = readSecureCredentials(deps({
      timeoutMs: 100,
      isAvailable: () => stage === "availability" ? held : Promise.resolve(true),
      decrypt: () => stage === "decryption" ? held : Promise.resolve('{"existing":"saved"}'),
    })).then((value) => { result = value; });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(result).toMatchObject({ status: "unavailable", credentials: {} });
      answer(stage === "availability" ? true : '{"existing":"saved"}');
      await pending;
      expect(result).toMatchObject({ status: "unavailable", credentials: {} });
    } finally {
      answer(stage === "availability" ? true : '{"existing":"saved"}');
      await pending;
    }
  });

  it("cannot persist a late encryption result over a later successful credential update", async () => {
    vi.useFakeTimers();
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    let attempts = 0;
    let disk = Buffer.from("original encrypted record");
    const state = createSecureCredentialState({ account: "original" }, async (next) => {
      const encrypted = await secureStorage.withSecureStorageDeadline(
        () => ++attempts === 1 ? held : Promise.resolve(Buffer.from(`encrypted:${next.account}`)), 100,
      );
      disk = encrypted;
    });
    const first = state.update(() => ({ account: "timed-out" })).then(
      () => ({ ok: true }), (error) => ({ ok: false, name: error.name }),
    );
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(await first).toEqual({ ok: false, name: "SecureStorageTimeoutError" });
      expect(state.read()).toEqual({ account: "original" });
      expect(disk.toString()).toBe("original encrypted record");
      await state.update(() => ({ account: "new" }));
      answer(Buffer.from("late encrypted old record"));
      await Promise.resolve();
      await Promise.resolve();
      expect(state.read()).toEqual({ account: "new" });
      expect(disk.toString()).toBe("encrypted:new");
    } finally {
      answer(Buffer.from("late encrypted old record"));
      await first;
    }
  });
});
