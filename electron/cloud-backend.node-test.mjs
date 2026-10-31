import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHIPPED_CLOUD_ORIGIN, cloudServicePosture, configuredCloudOrigin } from "./cloud-backend.mjs";

test("no cloud service ships configured", () => {
  assert.equal(SHIPPED_CLOUD_ORIGIN, null);
});

test("an unconfigured environment is inert and never names an origin", () => {
  const posture = cloudServicePosture({});
  assert.deepEqual(posture, { inert: true, origin: null, reason: "no-configured-cloud-service" });
});

test("the upstream staging toggle alone never activates a service", () => {
  assert.equal(cloudServicePosture({ OMB_CLOUD_STAGING: "1" }).inert, true);
});

test("an explicit configured origin activates the service; shape check is not ownership proof", () => {
  assert.equal(configuredCloudOrigin("https://cloud.example.com"), "https://cloud.example.com");
  assert.equal(configuredCloudOrigin("https://cloud.example.com/"), "https://cloud.example.com");
  assert.equal(configuredCloudOrigin("http://cloud.example.com"), null);
  assert.equal(configuredCloudOrigin("https://user@cloud.example.com"), null);
  assert.equal(configuredCloudOrigin("https://cloud.example.com/#frag"), null);
  assert.equal(configuredCloudOrigin("not a url"), null);
  assert.deepEqual(cloudServicePosture({ DANI_CLOUD_ORIGIN: "https://cloud.example.com" }),
    { inert: false, origin: "https://cloud.example.com", reason: null });
});

test("the desktop's cloud-account entry consults the posture before building a client", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function ensureCloudAccount()");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.ok(body.includes("cloudServicePosture("), "ensureCloudAccount must consult the posture");
  assert.ok(body.indexOf("cloudServicePosture(") < body.indexOf("createCloudAccountClient("),
    "the posture check must precede client construction");
  assert.ok(body.includes("CLOUD_UNAVAILABLE_MESSAGE"), "the inert path must fail with the honest message");
});
