import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataDir } from "./data-dir-default.mjs";

const homes = [];
const home = () => { const h = mkdtempSync(join(tmpdir(), "dani-home-")); homes.push(h); return h; };
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });

describe("defaultDataDir", () => {
  it("is ~/.danibot, where the earlier Dani Bot builds keep their data", () => {
    const h = home();
    mkdirSync(join(h, ".danibot"));
    writeFileSync(join(h, ".danibot", "config.json"), '{"mine":true}');
    expect(defaultDataDir(h)).toBe(join(h, ".danibot"));
    expect(readFileSync(join(h, ".danibot", "config.json"), "utf8")).toBe('{"mine":true}');
  });
  it("never adopts an upstream OpenMausBot profile in ~/.openmausbot, and leaves it untouched", () => {
    const h = home();
    mkdirSync(join(h, ".openmausbot"));
    writeFileSync(join(h, ".openmausbot", "config.json"), '{"upstream":true}');
    expect(defaultDataDir(h)).toBe(join(h, ".danibot"));
    expect(readFileSync(join(h, ".openmausbot", "config.json"), "utf8")).toBe('{"upstream":true}');
  });
});

describe("one data dir across the app", () => {
  const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
  const EXPRESSION = "process.env.DANI_DATA_DIR || process.env.OMB_DATA_DIR || defaultDataDir(";
  it("resolves it the same way in the desktop shell and the save-file guard as the server does", () => {
    expect(source("./main.mjs")).toContain(EXPRESSION);
    expect(source("./save-file.mjs")).toContain(EXPRESSION);
    expect(source("../server/config.ts")).toContain("process.env.DANI_DATA_DIR ?? process.env.OMB_DATA_DIR ?? defaultDataDir(");
  });
});
