import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataDir } from "./data-dir-default.mjs";

const homes = [];
const home = () => { const h = mkdtempSync(join(tmpdir(), "dani-home-")); homes.push(h); return h; };
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });

describe("defaultDataDir", () => {
  it("uses ~/.danibot on a fresh machine", () => {
    const h = home();
    expect(defaultDataDir(h)).toBe(join(h, ".danibot"));
  });
  it("keeps reading an existing ~/.openmausbot in place, without moving or changing it", () => {
    const h = home();
    mkdirSync(join(h, ".openmausbot"));
    writeFileSync(join(h, ".openmausbot", "config.json"), '{"keep":true}');
    expect(defaultDataDir(h)).toBe(join(h, ".openmausbot"));
    expect(readFileSync(join(h, ".openmausbot", "config.json"), "utf8")).toBe('{"keep":true}');
    expect(existsSync(join(h, ".danibot"))).toBe(false);
  });
  it("prefers ~/.danibot when both exist, and never touches the other", () => {
    const h = home();
    mkdirSync(join(h, ".openmausbot"));
    mkdirSync(join(h, ".danibot"));
    expect(defaultDataDir(h)).toBe(join(h, ".danibot"));
    expect(existsSync(join(h, ".openmausbot"))).toBe(true);
  });
});
