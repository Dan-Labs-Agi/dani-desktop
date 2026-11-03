import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { profileDecision } from "./profile-compatibility.mjs";
const old = "/data/Dani Bot", current = "/data/dani-desktop";
function decision(existing, extra = {}) {
  return profileDecision({ platform: "darwin", packaged: true, appData: "/data", current,
    inspect(file) { if (!existing.includes(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return { isDirectory: () => true, isSymbolicLink: () => false }; }, ...extra });
}
describe("non-destructive profile compatibility", () => {
  it("continues the established profile when it alone exists", () => expect(decision([old])).toEqual({ kind: "continue", path: old }));
  it("continues the new-only profile", () => expect(decision([current])).toEqual({ kind: "continue", path: current }));
  it("preserves the current default for a new install", () => expect(decision([])).toEqual({ kind: "continue", path: current }));
  it("never guesses between two profiles", () => expect(decision([old,current])).toEqual({ kind: "choose", established: old, current }));
  it.each(["established","current"])("uses only the explicit %s choice", choice => expect(decision([old,current],{ choice }).path).toBe(choice === "established" ? old : current));
  it("rejects unknown choices", () => expect(decision([old,current],{ choice: "../../other" }).kind).toBe("choose"));
  it.each(["linux","freebsd"])("leaves %s untouched without inspecting files", platform => expect(decision([],{platform,inspect(){throw Error("must not inspect");}})).toEqual({kind:"continue",path:current}));
  it("also applies existing-profile rules on Windows",()=>expect(decision([old],{platform:"win32"})).toEqual({kind:"continue",path:old}));
  it("leaves development untouched",()=>expect(decision([old],{packaged:false})).toEqual({kind:"continue",path:current}));
  it("does not treat denied access as missing",()=>expect(()=>decision([],{inspect(){throw Object.assign(Error("denied"),{code:"EACCES"});}})).toThrow("denied"));
  it("rejects symlinks rather than following another profile",()=>expect(()=>decision([],{inspect(){return {isDirectory:()=>true,isSymbolicLink:()=>true};}})).toThrow("plain directory"));
  it("resolves before dynamically importing main, and isolates chooser session before readiness",()=>{
    const entry=readFileSync(new URL("./entry.mjs",import.meta.url),"utf8");
    expect(entry.indexOf('app.setPath("userData", decision.path)')).toBeLessThan(entry.indexOf('await import("./main.mjs")'));
    expect(entry.indexOf('app.setPath("sessionData", chooser)')).toBeLessThan(entry.indexOf('await app.whenReady()'));
    expect(entry).not.toContain('import "./main.mjs"');
    expect(entry).not.toMatch(/rename|unlink|rmSync|encryptString|setName/);
  });
});
