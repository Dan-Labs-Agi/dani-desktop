import assert from "node:assert/strict";
import test from "node:test";
import { createSecureCredentialAccess } from "./secure-credential-access.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake store + fake filesystem. ops records every observable operation in
 * order, so tests can assert attempts never interleave. */
const rig = (over = {}) => {
  const ops = [];
  let bytes = Buffer.from("cipher");
  const files = new Map();
  const rig = {
    ops, files,
    written: () => files.get("store"),
    tmps: () => [...files.keys()].filter((k) => k !== "store"),
    access: createSecureCredentialAccess({
      store: {
        exists: () => bytes !== null,
        isAvailable: async () => true,
        readFile: () => { ops.push("readFile"); return bytes; },
        decrypt: async () => JSON.stringify({ composioApiKey: "ak_live" }),
        encrypt: async (text) => { ops.push("encrypt"); return Buffer.from(`enc:${text}`); },
      },
      sleep: wait,
      timeoutMs: 30,
      fs: {
        mkdir: () => ops.push("mkdir"),
        writeFile: (file, data) => { ops.push(`writeFile:${file}`); files.set(file, data); },
        rename: (from, to) => { ops.push(`rename:${from}->${to}`); files.set(to, files.get(from)); files.delete(from); },
        unlink: (file) => { ops.push(`unlink:${file}`); files.delete(file); },
      },
      storeFile: "store",
      onUnavailable: (error) => ops.push(`unavailable:${error}`),
      onRecovered: () => ops.push("recovered"),
      ...over.access,
    }),
  };
  if (over.decrypt) {
    // rebuild with caller's decrypt
    return rig.with({ store: { decrypt: over.decrypt } });
  }
  rig.with = (patch) => createSecureCredentialAccess({
    store: {
      exists: () => bytes !== null,
      isAvailable: async () => true,
      readFile: () => { ops.push("readFile"); return bytes; },
      decrypt: async () => JSON.stringify({ composioApiKey: "ak_live" }),
      encrypt: async (text) => { ops.push("encrypt"); return Buffer.from(`enc:${text}`); },
      ...patch.store,
    },
    sleep: wait,
    timeoutMs: patch.timeoutMs ?? 30,
    fs: {
      mkdir: () => ops.push("mkdir"),
      writeFile: (file, data) => { ops.push(`writeFile:${file}`); files.set(file, data); },
      rename: (from, to) => { ops.push(`rename:${from}->${to}`); files.set(to, files.get(from)); files.delete(from); },
      unlink: (file) => { ops.push(`unlink:${file}`); files.delete(file); },
      ...patch.fs,
    },
    storeFile: "store",
    onUnavailable: (error) => ops.push(`unavailable:${error}`),
    onRecovered: () => ops.push("recovered"),
  });
  rig.setBytes = (b) => { bytes = b; };
  return rig;
};

test("a hung boot read ends unavailable, blocks writes, and never touches the disk", async () => {
  const r = rig();
  const access = r.with({ store: { decrypt: () => new Promise(() => {}) } });
  const result = await access.read();
  assert.equal(result.status, "unavailable");
  assert.equal(result.timedOut, true);
  assert.equal(access.isUnavailable(), true);
  await assert.rejects(access.save({ k: "v" }), /has not been changed/);
  assert.deepEqual(r.ops.filter((o) => o.startsWith("writeFile") || o.startsWith("rename")), []);
  assert.equal(r.written(), undefined);
});

test("retry after a timeout reads the real keys once, recovers once, and saves again", async () => {
  const r = rig();
  let calls = 0;
  const access = r.with({
    store: {
      decrypt: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve(JSON.stringify({ composioApiKey: "ak_live" }))),
    },
  });
  assert.equal((await access.read()).status, "unavailable");
  const retry = await access.read();
  assert.equal(retry.status, "ok");
  assert.deepEqual(retry.credentials, { composioApiKey: "ak_live" });
  assert.equal(access.isUnavailable(), false);
  // Recovered exactly once - the hook main would use for any one-time flip.
  assert.deepEqual(r.ops.filter((o) => o === "recovered"), ["recovered"]);
  await access.save({ composioApiKey: "ak_live", extra: "1" });
  assert.ok(String(r.written()).includes("ak_live"));
});

test("reads and writes are mutually serial: a retry during an in-flight write cannot interleave", async () => {
  const r = rig();
  let releaseEncrypt;
  const access = r.with({
    store: { encrypt: () => new Promise((resolve) => { releaseEncrypt = () => resolve(Buffer.from("enc:done")); }) },
  });
  const saving = access.save({ a: 1 });
  await wait(5); // the write holds the chain inside encrypt
  const retrying = access.read();
  await wait(20); // generous: if read bypassed the write it would have run
  const readFileDuringWrite = r.ops.indexOf("readFile") !== -1;
  assert.equal(readFileDuringWrite, false, "read must wait for the in-flight write");
  releaseEncrypt();
  await saving;
  const retry = await retrying;
  assert.equal(retry.status, "ok");
  // Strict order: the whole write finished before the read began.
  const lastWrite = r.ops.map((o, i) => (o.startsWith("rename") ? i : -1)).reduce((a, b) => Math.max(a, b));
  const firstRead = r.ops.indexOf("readFile");
  assert.ok(lastWrite !== -1 && firstRead > lastWrite, r.ops.join(","));
});

test("a stale timed-out write leaves no tmp and no late filesystem effect", async () => {
  const r = rig();
  let lateResolve;
  const access = r.with({
    store: { encrypt: () => new Promise((resolve) => { lateResolve = resolve; }) },
  });
  await assert.rejects(access.save({ a: 1 }), /did not answer in time/);
  lateResolve(Buffer.from("late-ciphertext"));
  await wait(50);
  assert.deepEqual(r.tmps(), []);
  assert.equal(r.written(), undefined);
  // A following attempt (with a working store) writes cleanly.
  const ok = r.with({}); // same fs spies, resolving encrypt
  await ok.save({ a: 2 });
  assert.ok(String(r.written()).includes('"a":2'));
});

test("a failed rename removes only this attempt's own tmp file", async () => {
  const r = rig();
  const access = r.with({
    fs: {
      rename: () => { throw new Error("rename denied"); },
    },
  });
  await assert.rejects(access.save({ a: 1 }), /rename denied/);
  const unlinked = r.ops.filter((o) => o.startsWith("unlink:")).map((o) => o.slice(7));
  assert.deepEqual(unlinked, ["store.1.tmp"]);
  assert.deepEqual(r.tmps(), []);
  assert.equal(r.written(), undefined);
});

test("a late read resolution can never overwrite a newer attempt's state", async () => {
  const r = rig();
  let lateResolve;
  let calls = 0;
  const access = r.with({
    store: {
      decrypt: () => (++calls === 1
        ? new Promise((resolve) => { lateResolve = resolve; })
        : Promise.resolve(JSON.stringify({ composioApiKey: "fresh_key" }))),
    },
  });
  const first = await access.read();
  assert.equal(first.status, "unavailable");
  const second = await access.read();
  assert.equal(second.status, "ok");
  lateResolve(JSON.stringify({ composioApiKey: "stale_key" }));
  await wait(50);
  assert.equal(access.state().read().composioApiKey, "fresh_key");
});

test("an empty store is a fresh install: ok, empty, writable", async () => {
  const r = rig();
  r.setBytes(null);
  const access = r.with({ store: { exists: () => false } });
  const result = await access.read();
  assert.equal(result.status, "empty");
  assert.equal(access.isUnavailable(), false);
  await access.save({ first: "key" });
  assert.ok(String(r.written()).includes("first"));
});

test("concurrent saves complete in order under unique attempt names", async () => {
  const r = rig();
  const access = r.with({});
  await Promise.all([access.save({ n: 1 }), access.save({ n: 2 }), access.save({ n: 3 })]);
  const writes = r.ops.filter((o) => o.startsWith("writeFile:")).map((o) => o.slice(10));
  assert.deepEqual(writes, ["store.1.tmp", "store.2.tmp", "store.3.tmp"]);
  assert.ok(String(r.written()).includes('"n":3'));
});
