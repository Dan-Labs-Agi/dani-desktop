// This gate requires native Apple CryptoKit. Node-only round trips cannot prove it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHONE_SECRET_INFO, PhoneSecretBridge, phoneSecretAAD, type PhoneSecretContext } from "./phone-secret.ts";

const keyId = "taWSR_nZ7ojlH_0Z3tar6Q";
// Public checked-in test identity, never an account credential.
const jwk = {
  kty: "EC", crv: "P-256",
  x: "g8FDXb91acXUNkuxNk7dWDQ0aN2zn6On2HeOGOvZOjs",
  y: "bJelczS0LM82rfXV68PmSJhz2ePosj3fL974XckCpDU",
  d: "5B-SwYLGXc04u4v7YLpzFrwj2JjysBFaJevOPl3h3Zg",
};
const context = {
  version: 1 as const, keyId, deviceId: "paired-device-1", botId: "bot-1",
  threadId: "thread-1", messageId: "message-1", target: "ttsKey", requestKey: "credential-request-1",
};

describe.skipIf(process.platform !== "darwin")("published Dani Node/CryptoKit credential interoperability", () => {
  let directory: string;
  let binary: string;
  const run = (mode: string, input?: string) => {
    const result = spawnSync(binary, [mode], { input, encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    // Do not include child stdout or decrypted values in an error message.
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  };
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "dani-phone-interop-"));
    binary = join(directory, "interop");
    const compiled = spawnSync("swiftc", [
      "-parse-as-library",
      fileURLToPath(new URL("../ios/Sources/CompanionCore/PhoneSecret.swift", import.meta.url)),
      fileURLToPath(new URL("./testing/phone-secret-interop.swift", import.meta.url)),
      "-o", binary,
    ], { encoding: "utf8", timeout: 45_000 });
    expect(compiled.error).toBeUndefined();
    expect(compiled.status, compiled.stderr).toBe(0);
  }, 50_000);
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  it("opens a fresh envelope encrypted by the actual Swift companion source in the Node server", async () => {
    const bridge = new PhoneSecretBridge(() => { throw new Error("unexpected credential save"); });
    bridge.receive({ type: "openmausbot:phone-secret-key", version: 1, keyId, privateKey: jwk });
    const envelope = { ...context, ...run("encrypt") } as PhoneSecretContext;
    expect(await bridge.open(envelope)).toBe("swift-to-node-secret");
    await expect(bridge.open({ ...envelope, messageId: "other-message" })).rejects.toThrow("could not be verified");
  });

  it("opens a fresh Node envelope with actual Swift AAD/INFO and native CryptoKit", async () => {
    const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
    const publicKey = await suite.kem.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, true);
    const encrypted = await suite.seal({ recipientPublicKey: publicKey, info: new TextEncoder().encode(PHONE_SECRET_INFO) },
      new TextEncoder().encode("swift-to-node-secret"), phoneSecretAAD(context));
    const envelope = {
      ...context, encapsulatedKey: Buffer.from(encrypted.enc).toString("base64url"),
      ciphertext: Buffer.from(encrypted.ct).toString("base64url"),
    };
    expect(run("decrypt", JSON.stringify(envelope))).toEqual({ ok: true });
  });
});
