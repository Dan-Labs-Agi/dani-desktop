import { describe, expect, it } from "vitest";
import { judgeRun } from "./release-ci.mjs";
import { assertReleaseIdentity } from "./release-version.mjs";

const sha = "a".repeat(40);
const other = "b".repeat(40);
const job = (name: string, conclusion = "success") => ({ name, conclusion, steps: [{ status: "completed", conclusion }] });
const vitestShards = (os: string, shards: number) =>
  Array.from({ length: shards }, (_, i) => job(`vitest (${os}, shard ${i + 1}/${shards})`));
const required = () => [
  ...vitestShards("macos-latest", 4),
  ...vitestShards("ubuntu-latest", 8),
  ...vitestShards("windows-latest", 8),
  job("package + smoke (Ubuntu 24.04 x64)"),
  job("control-plane check + workerd tests + dry run"),
  job("Detect optional jobs"),
];

describe("actual portable release CI", () => {
  it("recognizes the sharded native platform CI", () => {
    expect(judgeRun(required())).toBe("green");
    expect(judgeRun([...required(), job("Swift tests + iOS build", "skipped")])).toBe("green");
  });
  it("requires each native platform and the package/control-plane checks", () => {
    for (let index = 0; index < required().length; index += 1) {
      expect(judgeRun(required().filter((_, candidate) => candidate !== index))).not.toBe("green");
    }
  });
  it("does not ignore a failed optional or required job", () => {
    expect(judgeRun([...required(), job("Swift tests + iOS build", "failure")])).toBe("red");
    expect(judgeRun(required().map((entry, index) => index === 2 ? job(entry.name, "failure") : entry))).toBe("red");
  });
});

describe("immutable release candidate identity", () => {
  it("accepts a new candidate or an existing draft/tag pinned to the same SHA", () => {
    expect(() => assertReleaseIdentity({ sha })).not.toThrow();
    expect(() => assertReleaseIdentity({ sha, tagSha: sha, draftSha: sha })).not.toThrow();
  });
  it("refuses retargeting an existing version tag or draft", () => {
    expect(() => assertReleaseIdentity({ sha, tagSha: other })).toThrow(/tag|commit|SHA/i);
    expect(() => assertReleaseIdentity({ sha, draftSha: other })).toThrow(/draft|commit|SHA/i);
    expect(() => assertReleaseIdentity({ sha, draftSha: "main" })).toThrow(/draft|commit|SHA/i);
  });
});
