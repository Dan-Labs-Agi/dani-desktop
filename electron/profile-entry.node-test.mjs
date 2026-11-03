// Execute the real entry source in isolation to prove import order and cancellation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("./entry.mjs", import.meta.url), "utf8");
async function boot(decision, response = 2, args = []) {
  const calls = [], paths = { userData: "/data/dani-desktop", appData: "/data" };
  const exited = new Error("exited");
  const app = { isPackaged: true, getPath: key => paths[key], setPath(key,value){ calls.push(["path",key,value]);paths[key]=value; },
    whenReady(){calls.push(["ready"]);return Promise.resolve();}, relaunch(options){calls.push(["relaunch",options]);}, exit(){calls.push(["exit"]);throw exited;} };
  const context = vm.createContext({ process: { platform: "darwin", argv: ["app",...args] } });
  Object.assign(context, {app, dialog:{async showMessageBox(){calls.push(["dialog"]);return {response};},showErrorBox(){calls.push(["error"]);}},
    mkdtempSync(){calls.push(["temp"]);return "/isolated/chooser";}, os:{tmpdir:()=>"/isolated"}, path:{join:(...parts)=>parts.join("/")},
    PROFILE_CHOICE_PREFIX:"--dani-profile-choice=", profileDecision(input){calls.push(["decision",input.choice]);return decision;},
    loadMain:async()=>{calls.push(["main",paths.userData]);},
  });
  const executable = source.replace(/^import .+;$/gm, "").replace('await import("./main.mjs")', 'await loadMain()');
  try {await vm.runInContext(`(async()=>{${executable}\n})()`,context);}catch(error){if(error!==exited)throw error;}
  return calls;
}
test("old-only profile and session are selected before actual dynamic import",async()=>{
 const calls=await boot({kind:"continue",path:"/data/Dani Bot"});
 assert.deepEqual(calls.filter(c=>["path","main"].includes(c[0])),[["path","userData","/data/Dani Bot"],["path","sessionData","/data/Dani Bot"],["main","/data/Dani Bot"]]);
});
test("unchanged default is imported without resetting Linux/current paths",async()=>{
 const calls=await boot({kind:"continue",path:"/data/dani-desktop"});assert.equal(calls.some(c=>c[0]==="path"),false);assert.equal(calls.at(-1)[0],"main");
});
test("ambiguous cancel never imports main or opens either profile",async()=>{
 const calls=await boot({kind:"choose",established:"/data/Dani Bot",current:"/data/dani-desktop"});
 assert.equal(calls.some(c=>c[0]==="main"||c[0]==="relaunch"),false);
 assert.deepEqual(calls.filter(c=>c[0]==="path"),[["path","userData","/isolated/chooser"],["path","sessionData","/isolated/chooser"]]);
 assert.ok(calls.findIndex(c=>c[0]==="path")<calls.findIndex(c=>c[0]==="ready"));
});
test("each explicit chooser response relaunches once, stripping old selectors",async()=>{
 for(const response of [0,1]){
  const calls=await boot({kind:"choose",established:"/data/Dani Bot",current:"/data/dani-desktop"},response,["--test","--dani-profile-choice=bad"]);
  const relaunch=calls.filter(c=>c[0]==="relaunch");assert.equal(relaunch.length,1);assert.deepEqual(Array.from(relaunch[0][1].args),["--test",`--dani-profile-choice=${response===0?"established":"current"}`]);assert.equal(calls.some(c=>c[0]==="main"),false);
 }
});
