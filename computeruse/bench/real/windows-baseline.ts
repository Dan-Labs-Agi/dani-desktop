// Runs the real Windows cua-driver, through the real computer service with the checks on, against a disposable window this
// script opens itself, and records what the driver actually answered. It acts only on a window owned by that window's own
// process, uses background delivery so the person's mouse and keyboard are not taken over, and stops everything it started.
//   node --experimental-strip-types computeruse/bench/real/windows-baseline.ts [--phase read|checked|stale|foreground|readwindow|all] [--out FOLDER]
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { ComputerGuards } from "../../guards.ts";
import { gatedLocalComputer } from "../../local-computer.ts";

if (process.platform !== "win32") {
  console.error("windows-baseline runs the Windows driver and nothing else");
  process.exit(1);
}

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DRIVER = join(ROOT, "dist-native", "cua-win32-x64", "cua-driver.exe");
const FIXTURE = fileURLToPath(new URL("./fixture-window.ps1", import.meta.url));
const argument = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const phase = argument("phase") ?? "all";
const reportDirectory = argument("out") ?? join(ROOT, "evals", "reports", "computer");

if (!existsSync(DRIVER)) {
  console.error(`The staged driver is missing at ${DRIVER}; run pnpm build:cua:win first.`);
  process.exit(1);
}

const CHECKED: ComputerGuards = { stale: true, loop: true, typing: true, anchor: true, scroll: true, untrusted: true, guidance: true, pointer: true, evidence: true, risk: true };
const driverEnv = { CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" };

interface Observation { step: string; tool: string; ms: number; isError: boolean; text: string; structured?: unknown }
const observations: Array<Observation & { phase: string }> = [];
const clip = (text: string, length = 600) => (text.length > length ? `${text.slice(0, length)}…` : text);

const daemonRunning = (): boolean => !/not running/i.test(spawnSync(DRIVER, ["status"], { env: { ...process.env, ...driverEnv }, encoding: "utf8", timeout: 20_000 }).stdout ?? "");
const daemonWasRunning = daemonRunning();
if (daemonWasRunning) console.log("A driver daemon was already running before this started; it will be left alone.");

const folder = mkdtempSync(join(tmpdir(), "danibot-a0-"));
let fixture: ChildProcess | undefined;
let fixturePid = 0;

async function startFixture(): Promise<void> {
  fixture = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", FIXTURE, "-Out", folder], { windowsHide: true, stdio: "ignore" });
  const ready = join(folder, "ready.json");
  for (let waited = 0; !existsSync(ready); waited += 250) {
    if (waited > 25_000) throw new Error("The fixture window did not report ready.");
    await delay(250);
  }
  fixturePid = JSON.parse(readFileSync(ready, "utf8")).pid;
}

interface Session { call(name: string, args?: Record<string, unknown>, step?: string): Promise<Record<string, any>>; counters(): any; close(): Promise<void> }

async function openSession(label: string, verifyEffects: boolean, guards: ComputerGuards, broker: (query: URLSearchParams) => unknown, platform: "win32" | "linux" = "win32"): Promise<Session> {
  let evidence: any = null;
  const checks: URLSearchParams[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST") {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => { evidence = JSON.parse(raw); response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); });
      return;
    }
    checks.push(url.searchParams);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(broker(url.searchParams)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const connection = gatedLocalComputer(
    { command: DRIVER, args: ["mcp"], env: driverEnv, platform, scope: "local-computer" },
    { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/control`, token: "a0-token" }, false, verifyEffects, guards);
  const child = spawn(connection.command, connection.args, { env: { ...process.env, ...connection.env }, stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  const replies = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout! }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    } catch { /* a line that is not a frame is not an answer */ }
  });
  let next = 0;
  const request = (method: string, params: unknown, waitMs = 30_000): Promise<any> => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), waitMs);
    replies.set(id, (value) => { clearTimeout(timer); resolve(value); });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "danibot-a0", version: "1" } });
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    async call(name, args = {}, step = name) {
      const started = Date.now();
      const answer = await request("tools/call", { name, arguments: args });
      const result = answer.result ?? { isError: true, content: [{ type: "text", text: JSON.stringify(answer.error ?? answer) }] };
      const text = (result.content ?? []).map((part: any) => part.text ?? "").join("\n");
      observations.push({ phase: label, step, tool: name, ms: Date.now() - started, isError: result.isError === true, text: clip(text), structured: summarize(result.structuredContent) });
      return result;
    },
    counters: () => ({ evidence, checks: checks.map((query) => Object.fromEntries(query)) }),
    async close() {
      const exited = once(child, "exit");
      child.stdin!.end();
      await Promise.race([exited, delay(8_000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** What the driver returned, shortened: the shape of its elements and whether a value was present, never a value itself. */
function summarize(structured: any): unknown {
  if (!structured || typeof structured !== "object") return undefined;
  const elements = Array.isArray(structured.elements) ? structured.elements : undefined;
  return {
    keys: Object.keys(structured),
    ...(elements ? { elementCount: elements.length, elementKeys: [...new Set(elements.flatMap((element: any) => Object.keys(element)))],
      elements: elements.slice(0, 40).map((element: any) => ({ ...Object.fromEntries(Object.entries(element).filter(([key]) => key !== "value")), hasValue: typeof element.value === "string" && element.value !== "" })) } : {}),
    ...(structured.effect === undefined ? {} : { effect: structured.effect }),
  };
}

const labelOf = (element: any): string | undefined => element.label ?? element.name ?? element.title;
const elementNamed = (state: Record<string, any>, name: string) => (state.structuredContent?.elements ?? []).find((element: any) => labelOf(element) === name);

async function findWindow(session: Session): Promise<{ pid: number; window_id: number }> {
  const listed = await session.call("list_windows", {}, "find the fixture window");
  const windows: any[] = listed.structuredContent?.windows ?? [];
  const mine = windows.find((window) => window.pid === fixturePid && String(window.title ?? "").includes("DaniBot driver fixture"));
  if (!mine) throw new Error(`The driver does not list the fixture window (pid ${fixturePid}); it lists ${windows.length} windows.`);
  return { pid: mine.pid, window_id: mine.window_id };
}

const findings: Array<{ finding: string; detail: unknown }> = [];
const note = (finding: string, detail: unknown) => { findings.push({ finding, detail }); console.log(`- ${finding}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); };
const file = (name: string) => { const path = join(folder, name); return existsSync(path) ? readFileSync(path, "utf8") : null; };

async function readPhase() {
  const session = await openSession("read", false, {}, () => ({ held: false, helpOpen: false }));
  try {
    const target = await findWindow(session);
    note("window found, owned by the fixture's own process", target);
    const tools = await session.call("get_window_state", { ...target, include_screenshot: false }, "read the fixture window, no checks");
    const state = tools.structuredContent ?? {};
    note("keys of a window read", Object.keys(state));
    const elements: any[] = state.elements ?? [];
    note("keys of an element", [...new Set(elements.flatMap((element) => Object.keys(element)))]);
    note("elements", elements.map((element) => ({ role: element.role, label: labelOf(element), index: element.element_index, token: element.element_token, hasValue: typeof element.value === "string" && element.value !== "", depth: element.depth })));
    const secret = elementNamed(tools, "Card number");
    note("does the driver return the secure field's value", secret ? (typeof secret.value === "string" && secret.value !== "" ? "YES, a value is present" : "no value present") : "the secure field is not in the read");
    note("is the read complete", { elements_complete: state.elements_complete, truncated: state.truncated, degraded: state.degraded });
    note("the driver's own counts and note", { element_count: state.element_count, returned_element_count: state.returned_element_count, total_element_count: state.total_element_count, snapshot_id: state.snapshot_id, note: state._note });
  } finally {
    await session.close();
  }
}

async function readWindowPhase() {
  const session = await openSession("readwindow", false, { readWindow: true }, () => ({ held: false, helpOpen: false }));
  try {
    const target = await findWindow(session);
    const ordinary = await session.call("get_window_state", target, "read the fixture window the ordinary way, screenshot and all");
    const plain = await session.call("read_window", target, "read_window on the fixture window");
    const body = (plain.content ?? []).map((part: any) => part.text ?? "").join("\n");
    const queried = await session.call("read_window", { ...target, query: "Body" }, "read_window with a query");
    note("read_window answer shape", { isError: plain.isError === true, partTypes: (plain.content ?? []).map((part: any) => part.type), hasStructuredContent: plain.structuredContent !== undefined });
    note("size of the answer, in characters of JSON", { readWindow: JSON.stringify(plain).length, ordinaryRead: JSON.stringify(ordinary).length, withQuery: JSON.stringify(queried).length });
    note("the ordinary read's parts", (ordinary.content ?? []).map((part: any) => part.type));
    const named = elementNamed(ordinary, "Body");
    note("read_window names the Body field with the token to act on it", { named: body.includes("Body"), token: named?.element_token ? body.includes(String(named.element_token)) : "no token in the ordinary read" });
    note("read_window text", body.length > 700 ? body.slice(0, 700) + "…" : body);
    note("read_window with a query keeps the matching row", (queried.content ?? []).map((part: any) => part.text ?? "").join("\n").includes("Body"));
  } finally {
    await session.close();
  }
}

const tokenOf = (state: Record<string, any>, name: string): string | undefined => elementNamed(state, name)?.element_token;
const said = (result: Record<string, any>, length = 450) => clip((result.content ?? []).map((part: any) => part.text).join(" | "), length);

async function checkedPhase() {
  const refused = "The person has not answered yet, so this call was NOT performed.";
  const session = await openSession("checked", true, CHECKED, (query) => (query.get("risk") === "final" ? { held: true, helpOpen: false, blockedReason: refused } : { held: false, helpOpen: false }));
  try {
    const target = await findWindow(session);
    const read = async (step: string) => session.call("get_window_state", { ...target, include_screenshot: false }, step);
    let state = await read("read before acting");
    if (!tokenOf(state, "Mark")) throw new Error("The driver's read does not give the Mark button a token; see the read phase.");

    const mark = await session.call("click", { ...target, element_token: tokenOf(state, "Mark"), delivery_mode: "background" }, "click Mark: its label changes, so the window changes");
    note("click Mark (visible effect)", { isError: mark.isError === true, text: said(mark), effectField: mark.structuredContent?.effect });

    state = await read("read after Mark");
    note("Mark's label after the click", elementNamed(state, "Mark") ? labelOf(elementNamed(state, "Mark")) : "Mark is gone; the button now reads " + JSON.stringify((state.structuredContent?.elements ?? []).filter((element: any) => element.role === "Button").map(labelOf)));
    const save = await session.call("click", { ...target, element_token: tokenOf(state, "Save"), delivery_mode: "background" }, "click Save: writes a file, window looks the same");
    note("click Save (effect outside the window)", { isError: save.isError === true, text: said(save, 600), savedCount: file("saved.count") });

    state = await read("read before typing");
    const typed = await session.call("set_value", { ...target, element_token: tokenOf(state, "Body"), value: "hello" }, "set_value Body to hello");
    note("set_value Body", { isError: typed.isError === true, text: said(typed), typing: typed.structuredContent });

    state = await read("read before second save");
    await session.call("click", { ...target, element_token: tokenOf(state, "Save"), delivery_mode: "background" }, "click Save again, to see what the field held");
    note("ground truth: what Save wrote after set_value", { saved: file("saved.txt"), count: file("saved.count") });

    state = await read("read before Send");
    const send = await session.call("click", { ...target, element_token: tokenOf(state, "Send"), delivery_mode: "background" }, "click Send, a final action the broker holds back");
    note("click Send with the broker holding it back", { isError: send.isError === true, text: clip(said(send), 200), sentFileExists: file("sent.txt") !== null });

    const cursor = await session.call("get_agent_cursor_state", {}, "is the agent cursor on");
    const shown = cursor.structuredContent?.invalid_output ?? cursor.structuredContent;
    note("agent cursor after the pointer stage ran", { enabled: shown?.enabled, glide_duration_ms: shown?.motion?.glide_duration_ms, dwell_after_click_ms: shown?.motion?.dwell_after_click_ms, driverCalledItsOwnAnswerInvalid: cursor.isError === true });
    const counted = session.counters();
    note("checks the bridge asked the broker about", counted.checks.map((query: Record<string, string>) => (query.risk ? { risk: query.risk, tool: query.rtool, label: query.rlabel } : "ordinary")));
  } finally {
    await session.close();
    note("what the session counted, and the latency the checks added", session.counters().evidence);
  }
}

async function stalePhase() {
  // Without the risk rule, so a token the bridge cannot place in its last read reaches the driver and the driver answers it.
  const session = await openSession("stale", true, { ...CHECKED, risk: false }, () => ({ held: false, helpOpen: false }));
  try {
    const target = await findWindow(session);
    const read = (step: string) => session.call("get_window_state", { ...target, include_screenshot: false }, step);
    const first = await read("first read, for a token");
    const oldToken = tokenOf(first, "Mark");
    const second = await read("second read, which mints new tokens");
    note("tokens differ between reads", { first: oldToken, second: tokenOf(second, "Mark") });
    const stale = await session.call("click", { ...target, element_token: oldToken, delivery_mode: "background" }, "click with a token from an earlier read");
    note("click with a token from the earlier read", { isError: stale.isError === true, text: said(stale, 500) });
    const fresh = await session.call("click", { ...target, element_token: tokenOf(second, "Mark"), delivery_mode: "background" }, "click with the latest token");
    note("click with the latest token", { isError: fresh.isError === true, text: said(fresh, 300) });
  } finally {
    await session.close();
  }
}

/** Foreground delivery moves the person's real mouse and sends real keystrokes, so it runs only when asked for by name, never
 * as part of `all`. The window shows a banner saying so, and every call is bounded to the fixture's own window. */
async function foregroundPhase() {
  const refused = "The person has not answered yet, so this call was NOT performed.";
  const broker = (query: URLSearchParams) => (query.get("risk") === "final" ? { held: true, helpOpen: false, blockedReason: refused } : { held: false, helpOpen: false });
  const tokenFor = (state: Record<string, any>, name: string) => elementNamed(state, name)?.element_token;
  const bodyValue = (state: Record<string, any>) => elementNamed(state, "Body")?.value;
  const rawSession = await openSession("foreground-raw", false, {}, broker, "linux");
  let target: { pid: number; window_id: number };
  try {
    target = await findWindow(rawSession);
    const read = (step: string) => rawSession.call("get_window_state", { ...target, include_screenshot: false }, step);
    let state = await read("read before raw typing");
    const typed = await rawSession.call("type_text", { ...target, element_token: tokenFor(state, "Body"), text: "hello", delivery_mode: "foreground" }, "type hello in the foreground, with no Windows pacing in front of the driver");
    state = await read("read after raw typing");
    note("raw foreground type_text 'hello' (driver burst, no pacing)", { isError: typed.isError === true, text: said(typed, 300), fieldNow: bodyValue(state) });
    await rawSession.call("set_value", { ...target, element_token: tokenFor(state, "Body"), value: "" }, "clear the field through accessibility, no input");
  } finally {
    await rawSession.close();
  }
  const pacedSession = await openSession("foreground-paced", false, {}, broker, "win32");
  try {
    const read = (step: string) => pacedSession.call("get_window_state", { ...target, include_screenshot: false }, step);
    let state = await read("read before paced typing with no other check");
    const typed = await pacedSession.call("type_text", { ...target, element_token: tokenFor(state, "Body"), text: "hello", delivery_mode: "foreground" }, "type hello in the foreground with only the Windows pacing in front of the driver");
    state = await read("read after paced typing");
    note("paced foreground type_text 'hello', no other check (the pacing's own answer)", { isError: typed.isError === true, text: said(typed, 300), fieldNow: bodyValue(state) });
    await pacedSession.call("set_value", { ...target, element_token: tokenFor(state, "Body"), value: "" }, "clear the field through accessibility, no input");
  } finally {
    await pacedSession.close();
  }
  const session = await openSession("foreground-checked", true, CHECKED, broker, "win32");
  try {
    const read = (step: string) => session.call("get_window_state", { ...target, include_screenshot: false }, step);
    let state = await read("read before the foreground click");
    const click = await session.call("click", { ...target, element_token: tokenFor(state, "Mark"), delivery_mode: "foreground" }, "foreground click on Mark");
    state = await read("read after the foreground click");
    note("foreground click on Mark", { isError: click.isError === true, text: said(click, 400), markNow: labelOf(elementNamed(state, "Mark") ?? (state.structuredContent?.elements ?? []).find((element: any) => /Mark/.test(labelOf(element) ?? ""))) });
    const typed = await session.call("type_text", { ...target, element_token: tokenFor(state, "Body"), text: "hello", delivery_mode: "foreground" }, "type hello in the foreground, through the Windows pacing");
    state = await read("read after paced typing");
    note("paced foreground type_text 'hello'", { isError: typed.isError === true, text: said(typed, 400), fieldNow: bodyValue(state) });
    const quit = await session.call("click", { ...target, element_token: tokenFor(state, "Quit"), delivery_mode: "foreground" }, "foreground click on Quit, which closes the window");
    await delay(1_200);
    note("foreground click on Quit, which closes the window", { isError: quit.isError === true, text: said(quit, 600), structured: quit.structuredContent, fixtureStillRunning: fixture?.exitCode === null && spawnSync("tasklist", ["/fi", `pid eq ${fixturePid}`], { encoding: "utf8" }).stdout.includes(String(fixturePid)) });
  } finally {
    await session.close();
  }
}

try {
  await startFixture();
  console.log(`fixture window open, pid ${fixturePid}; phase: ${phase}`);
  if (phase === "read" || phase === "all") await readPhase();
  if (phase === "checked" || phase === "all") await checkedPhase();
  if (phase === "stale" || phase === "all") await stalePhase();
  if (phase === "foreground") await foregroundPhase();
  if (phase === "readwindow") await readWindowPhase();
} finally {
  if (fixture && fixture.exitCode === null) spawnSync("taskkill", ["/pid", String(fixture.pid), "/t", "/f"], { stdio: "ignore" });
  if (!daemonWasRunning && daemonRunning()) {
    spawnSync(DRIVER, ["stop"], { env: { ...process.env, ...driverEnv }, stdio: "ignore", timeout: 20_000 });
    console.log("Stopped the driver daemon this run started.");
  }
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(join(reportDirectory, "windows-baseline.json"), JSON.stringify({ at: new Date().toISOString(), driver: "0.28.2", phase, findings, observations }, null, 2) + "\n");
  console.log(`report: ${join(reportDirectory, "windows-baseline.json")}`);
}
