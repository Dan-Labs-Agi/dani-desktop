// @vitest-environment happy-dom
// The first run: two screens, then the chat. Meeting the app (and connecting an AI when none works), then the Chief of
// Staff over the app; what it saves, where it lands, and what a reload or a replay does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro, useChiefStepOpen } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { WHATS_NEW_NOTICE } from "@/lib/notices";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import { saveWelcomeDraft } from "@/lib/welcome-draft";
import type { InstanceInfo } from "@/state/store";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), landed: vi.fn(), onDone: vi.fn(),
  checks: [] as string[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/EngineSetup", async (original) => {
  const { createElement: h } = await import("react");
  return { ...(await original<typeof import("@/components/EngineSetup")>()),
    EngineSetup: ({ instance }: { instance: InstanceInfo }) => h("div", { "data-engine-setup": instance.instanceId }) };
});
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
vi.mock("@/lib/danibot-landing", () => ({ FLIGHT_MS: 700, landInSidebar: (input: { botId: string; commit: () => void }) => { f.landed(input.botId); input.commit(); } }));
const { WelcomeFlow } = await import("./WelcomeFlow");
const { CHIEF_FADE_MS, CHIEF_GUARD_MS } = await import("./ChiefIntro");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claude = (ready: boolean, aiTest?: InstanceInfo["aiTest"]): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", install: { docsUrl: "https://example.test" },
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] }, ...(aiTest ? { aiTest } : {}),
});
const freeDani: InstanceInfo = {
  ...claude(true), instanceId: "dani", driverKind: "daniFree", displayName: "Dani",
  models: { default: "m", options: [{ id: "m", label: "Helpful model", availability: "available" }] },
};
const signIn = (): InstanceInfo => ({ ...claude(false), snapshot: { state: "available", authenticated: false }, authentication: { method: "paste-code" } } as InstanceInfo);
const dani = { id: "dani", threadId: "t", name: "DaniBot", title: "", description: "", notifications: true, color: "chrome", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true };

let host: HTMLDivElement, root: Root;
let chiefStep = false;
function Watch() {
  chiefStep = useChiefStepOpen();
  return null;
}
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);
const press = async (label: string) => { await act(async () => { button(label)!.click(); }); };
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const key = async (name: string) => {
  const screen = host.querySelector<HTMLElement>("[data-welcome]")!;
  await act(async () => { screen.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render([createElement(Watch, { key: "w" }), createElement(WelcomeFlow, { key: "f", onDone: f.onDone, ...extra })]); });
};
/** Next, the first screen's 100 ms fade, and the Chief dialog's input guard. */
const toChief = async (label = "Next") => {
  await press(label);
  await tick(100);
  await tick(CHIEF_GUARD_MS);
};
const saved = () => f.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT").map(([, init]) => JSON.parse(init.body));
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, String(v)), removeItem: (k: string) => void values.delete(k), clear: () => values.clear() };
};

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.animate = vi.fn(() => ({ onfinish: null, oncancel: null, cancel() {} }) as unknown as Animation);
  setLocale("en");
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  f.dispatch.mockReset();
  f.landed.mockReset();
  f.onDone.mockReset();
  f.api.mockReset();
  f.checks = [];
  f.api.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path.endsWith("/check")) { f.checks.push(path); return { ok: true }; }
    return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
  });
  f.state = { instances: [freeDani], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [dani], cloudAdd: null };
  stageIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a new install's first run", () => {
  it("is two screens with an AI already working: Next, then Create, and it lands in the Chief's chat", async () => {
    await show();
    expect(host.querySelector("h1")?.textContent).toBe("Meet Dani Bot");
    expect(host.querySelector("[data-demo-composer]")?.textContent, "reduced motion shows the whole sentence").toContain("Hand off any task to your team of bots");
    for (const gone of ["Step 1", "Back", "Skip", "Your name", "Connect an AI", "Set up later"]) expect(text()).not.toContain(gone);
    expect(button("Next")!.disabled).toBe(false);

    await press("Next");
    expect(host.querySelector("[data-welcome]")?.getAttribute("data-welcome"), "the first screen fades out first").toBe("meet");
    await tick(100);
    expect(host.querySelector("[role=dialog]")?.textContent).toContain("Introducing your Chief of Staff");
    expect(host.querySelector("[data-welcome]")!.className).toContain("ui-scrim");
    expect(chiefStep, "the app behind it is the empty shell").toBe(true);
    expect(button("Choose an existing bot"), "no bots of the person's own yet").toBeUndefined();

    await tick(CHIEF_GUARD_MS);
    await press("Create Chief of Staff");
    expect(f.landed).toHaveBeenCalledWith("dani");
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "dani", patch: { welcomed: true } });
    await tick(CHIEF_FADE_MS);
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("dani");
    expect(introStaged("dani"), "its first messages arrive one at a time").toBe(true);
    await act(async () => {});
    expect(saved()).toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] }) }]);
  });

  it("counts an AI once it answered one tiny test message, and never before", async () => {
    await show();
    expect(f.checks).toEqual(["/api/instances/dani/check"]);
    expect(button("Next")!.disabled).toBe(false);
    expect(host.querySelector("[data-sign-in]")).toBeNull();
  });

  it("comes back to the second screen after a reload there", async () => {
    saveWelcomeDraft({ beat: "chief" });
    await show();
    expect(text()).toContain("Introducing your Chief of Staff");
  });
});

describe("the Chief step", () => {
  const finishesAtNext = async () => {
    await show();
    await press("Next");
    await tick(100);
    expect(text()).not.toContain("Introducing your Chief of Staff");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
    expect(chiefStep).toBe(false);
  };

  it("is skipped once DaniBot has met the person", async () => {
    f.state = { ...f.state, bots: [{ ...dani, welcomed: true }] };
    await finishesAtNext();
  });

  it("is skipped where another bot is already the Chief", async () => {
    f.state = { ...f.state, bots: [{ ...dani, chiefOfStaff: false }, { ...dani, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: true }] };
    await finishesAtNext();
  });

  it("is skipped where there is no DaniBot", async () => {
    f.state = { ...f.state, bots: [] };
    await finishesAtNext();
  });
});

describe("What's new", () => {
  it("is left for a later launch by a first run on a desktop that sells the Cloud: everyone who installs sees it once", async () => {
    const seen = vi.fn(async () => {});
    vi.stubGlobal("ogb", { remoteClient: { active: false }, cloudAccount: { offer: vi.fn() }, desktopNotices: { seen } });
    await show();
    await toChief();
    await press("Create Chief of Staff");
    await tick(CHIEF_FADE_MS);
    await act(async () => {});
    expect(seen).not.toHaveBeenCalled();
    expect(saved()[0].onboarding.hintsSeen).toEqual([MET_CHIEF_HINT]);
    expect(localStorage.getItem(WHATS_NEW_NOTICE)).toBeNull();
  });
});

describe("with no AI working yet", () => {
  it("does not send hosted checks through optional agents before the local person chooses one", async () => {
    f.state = { ...f.state, instances: [claude(true)] };
    await show();
    expect(f.checks).toEqual([]);
    expect(button("Set up Dani")).toBeDefined();
    expect(button("Next")).toBeUndefined();
  });

  it("retains an explicit selected user bot without checking other optional agents", async () => {
    const chosen = { ...dani, id: "chosen", defaultBot: undefined, chiefOfStaff: false };
    f.state = { ...f.state, selectedId: "chosen", bots: [dani, chosen], instances: [claude(true), {
      ...claude(true), instanceId: "codex", driverKind: "codex", displayName: "Codex",
    }] };
    await show();
    expect(f.checks).toEqual(["/api/instances/claude/check"]);
    expect(button("Next")).toBeDefined();
  });

  it("keeps the robot welcome and offers free setup before any optional agent", async () => {
    f.state = { ...f.state, instances: [signIn()] };
    await show();
    expect(host.querySelector("h1")?.textContent).toBe("Meet Dani Bot");
    expect(button("Next")).toBeUndefined();
    expect(button("Set up Dani")).toBeDefined();
    expect(button("Sign in with Claude")).toBeUndefined();
    expect(text()).toMatch(/retain.*train/i);
    expect(host.querySelector("[data-engine-setup]")).toBeNull();
    await toChief("Set up later");
    expect(text()).toContain("Introducing your Chief of Staff");
  });

  it("opens installed optional agents only, and Escape closes the dialog without leaving welcome", async () => {
    f.state = { ...f.state, instances: [signIn(), { ...claude(false), instanceId: "missing", displayName: "Missing agent" }] };
    await show();
    await press("Other ways to connect");
    const dialog = host.querySelector("[data-connect-ai]")!;
    expect(dialog.textContent).toContain("Set up Dani");
    expect(dialog.textContent).toContain("Claude");
    expect(dialog.textContent).toContain("Sign-in required");
    expect(dialog.textContent).not.toContain("Missing agent");
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector("[data-connect-ai]")).toBeNull();
    expect(text()).toContain("Meet Dani Bot");
  });

  it("keeps setup available after a previously chosen agent failed its check", async () => {
    f.state = { ...f.state, instances: [claude(true, "failed")] };
    await show();
    expect(button("Set up Dani")).toBeDefined();
    expect(button("Next")).toBeUndefined();
  });

  it("preserves an already working chosen agent without forcing free setup", async () => {
    f.state = { ...f.state, selectedId: "chosen", bots: [{ ...dani, id: "chosen", defaultBot: undefined }], instances: [claude(true, "passed")] };
    await show();
    expect(button("Next")!.disabled).toBe(false);
    expect(f.checks).toEqual([]);
    expect(button("Set up Dani")).toBeUndefined();
  });

  it("does not infer free readiness from a catalog before activation", async () => {
    f.state = { ...f.state, instances: [{
      instanceId: "dani", driverKind: "daniFree", displayName: "Dani",
      snapshot: { state: "unavailable", authenticated: false },
      models: { default: "free", options: [{ id: "free", label: "Helpful model" }] },
    }] };
    await show();
    expect(button("Next")).toBeUndefined();
    expect(button("Set up Dani")).toBeDefined();
    expect(f.checks).toEqual([]);
  });

  it.each(["instance", "model"] as const)("does not probe or trust a policy-blocked free %s after a prior success", async (where) => {
    const blocked: InstanceInfo = where === "instance"
      ? { ...freeDani, policy: { organizationName: "Acme", reason: "Company models only." } }
      : { ...freeDani, models: { ...freeDani.models, options: freeDani.models.options.map((option) => ({ ...option, orgBlocked: true })) } };
    f.state = { ...f.state, instances: [blocked] };
    await show();
    expect(f.checks).toEqual([]);
    expect(button("Next")).toBeUndefined();
    f.state = { ...f.state, instances: [freeDani] };
    await show();
    expect(button("Next")).toBeDefined();
    expect(f.checks).toEqual(["/api/instances/dani/check"]);
    f.state = { ...f.state, instances: [{ ...blocked, aiTest: "passed" }] };
    await show();
    expect(button("Next")).toBeUndefined();
    expect(f.checks).toEqual(["/api/instances/dani/check"]);
  });

  it("shows Next once an installed agent actually answers", async () => {
    f.state = { ...f.state, selectedId: "chosen", bots: [{ ...dani, id: "chosen", defaultBot: undefined }], instances: [claude(false)] };
    await show();
    f.state = { ...f.state, instances: [claude(true)] };
    await show();
    expect(button("Next")!.disabled).toBe(false);
    expect(button("Set up later")).toBeUndefined();
  });

  it("keeps Escape as a nonblocking way to continue when setup is deferred", async () => {
    f.state = { ...f.state, instances: [claude(false)] };
    await show();
    await key("Escape");
    await tick(100);
    expect(text()).toContain("Introducing your Chief of Staff");
  });

  it("still enters chat when saving welcome completion fails", async () => {
    f.state = { ...f.state, bots: [], instances: [] };
    f.api.mockRejectedValue(new Error("offline"));
    await show();
    await press("Set up later");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe("other first runs", () => {
  it("gives a hosted place's admin the first screen only, then the chat", async () => {
    await show({ hosted: true });
    expect(text()).toContain("This is your team's shared Dani Bot");
    await press("Next");
    expect(text()).not.toContain("Introducing your Chief of Staff");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
    await toChief();
    await press("Create Chief of Staff");
    await tick(CHIEF_FADE_MS);
    await act(async () => {});
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("dani"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});
