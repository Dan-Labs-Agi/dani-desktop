import { describe, expect, it, vi } from "vitest";

import {
  CREDENTIAL_CALL_TIMED_OUT,
  CREDENTIAL_CALL_TIMEOUT_MS,
  encryptSecureDocument,
  readSecureCredentials,
} from "./secure-credentials.mjs";

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
describe("bounded credential waits", () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  it("declares UNAVAILABLE when decrypt never answers, once, without pretending the file is empty", async () => {
    const decrypt = vi.fn().mockReturnValue(new Promise(() => {}));
    const result = await readSecureCredentials(deps({ decrypt, timeoutMs: 25 }));
    expect(result.status).toBe("unavailable");
    expect(result.credentials).toEqual({});
    expect(result.error).toBe(CREDENTIAL_CALL_TIMED_OUT);
    expect(result.timedOut).toBe(true);
    // The timeout error names a wait, never corruption and never a prompt.
    expect(result.error).not.toMatch(/corrupt|prompt/i);
    // Prompt-gated waits are not busy stores: no backoff retry re-asks.
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("discards a decrypt that answers only after the attempt has already timed out", async () => {
    let lateResolve;
    const decrypt = vi.fn().mockReturnValue(
      new Promise((resolve) => { lateResolve = resolve; }),
    );
    const result = await readSecureCredentials(deps({ decrypt, timeoutMs: 25 }));
    expect(result.status).toBe("unavailable");
    lateResolve(JSON.stringify({ composioApiKey: "arrived-late" }));
    await wait(50);
    // The late answer must never surface through the settled attempt.
    expect(result.credentials).toEqual({});
    expect(result.settled()).toBe(true);
  });

  it("keeps the existing retry-and-recover behaviour for rejections, not just hangs", async () => {
    const decrypt = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValue(JSON.stringify({ composioApiKey: "ak_live" }));
    const result = await readSecureCredentials(deps({ decrypt, sleep: async () => {}, timeoutMs: 500 }));
    expect(result.status).toBe("ok");
    expect(result.credentials.composioApiKey).toBe("ak_live");
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("encryptSecureDocument rejects a write whose encrypt never answers, before any file write", async () => {
    const encrypt = vi.fn().mockReturnValue(new Promise(() => {}));
    await expect(encryptSecureDocument({ encrypt, timeoutMs: 25, sleep: wait })).rejects.toMatchObject({
      message: CREDENTIAL_CALL_TIMED_OUT,
      code: "credential-call-timeout",
    });
  });

  it("encryptSecureDocument still rejects when the late encrypt answer arrives after the budget", async () => {
    let lateResolve;
    const encrypt = vi.fn().mockReturnValue(new Promise((resolve) => { lateResolve = resolve; }));
    const pending = encryptSecureDocument({ encrypt, timeoutMs: 25, sleep: wait });
    await expect(pending).rejects.toMatchObject({ code: "credential-call-timeout" });
    lateResolve(Buffer.from("late-ciphertext"));
    await wait(50);
    // Settled already: nothing to apply, nothing else to throw.
  });

  it("encryptSecureDocument passes a prompt answer straight through", async () => {
    const encrypted = await encryptSecureDocument({
      encrypt: async () => Buffer.from("ciphertext"),
      timeoutMs: 500,
      sleep: wait,
    });
    expect(encrypted.toString()).toBe("ciphertext");
  });

  it("encryptSecureDocument rethrows ordinary encrypt failures untouched", async () => {
    const boom = new Error("keychain says no");
    await expect(
      encryptSecureDocument({ encrypt: async () => { throw boom; }, timeoutMs: 500, sleep: wait }),
    ).rejects.toBe(boom);
  });

  it("the default budget is the chosen 15s, overridable per call", async () => {
    expect(CREDENTIAL_CALL_TIMEOUT_MS).toBe(15000);
    const decrypt = vi.fn().mockResolvedValue(JSON.stringify({}));
    await readSecureCredentials(deps({ decrypt, timeoutMs: 1_000 }));
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("a timed-out read leaves the on-disk bytes untouched for the next attempt", async () => {
    const bytes = Buffer.from("cipher");
    let read = 0;
    const result = await readSecureCredentials(
      deps({
        readFile: () => { read += 1; return bytes; },
        decrypt: () => new Promise(() => {}),
        timeoutMs: 25,
      }),
    );
    expect(result.status).toBe("unavailable");
    expect(read).toBe(1);
    expect(bytes.toString()).toBe("cipher");
  });
});
