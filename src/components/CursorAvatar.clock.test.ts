// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MausAvatar, type MausAvatarHandle, type MausAvatarProps } from "./Avatar";
import { mascotClock } from "./mascot-clock";
import { UNREAD_NOTICE_MS, useUnreadNotice } from "./unread-notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const observed: { callback: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null } = { callback: null };
class FakeIntersectionObserver {
  constructor(callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    observed.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

let reducedMotion = false;
const motionListeners = new Set<() => void>();
vi.stubGlobal("matchMedia", (query: string) => ({
  get matches() { return query.includes("reduce") && reducedMotion; },
  addEventListener: (_: string, listener: () => void) => motionListeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener),
}));

let frameRequests = 0;
let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frameRequests++;
    return raf(callback);
  };
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  frameRequests = 0;
  reducedMotion = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (avatars: Array<Partial<MausAvatarProps> & { ref?: React.Ref<MausAvatarHandle> }>) =>
  act(() => root.render(avatars.map((props, key) => createElement(MausAvatar, { key, color: "green", ...props }))));
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const bodyPath = () => host.querySelector("svg")!.querySelector("path")!.getAttribute("d");
const eyeTransforms = () => [...host.querySelectorAll("svg g path")].map((p) => p.getAttribute("transform"));

describe("CursorAvatar on the shared clock", () => {
  it("draws every animated mascot from one animation frame", () => {
    render(Array.from({ length: 12 }, () => ({ state: "working" as const, size: 96 })));
    run(100);
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBeGreaterThan(30);
    expect(frameRequests).toBeLessThanOrEqual(70);
    expect(mascotClock().pending()).toBe(12);
  });

  it("draws a sidebar full of working mascots 20 times a second", () => {
    render(Array.from({ length: 12 }, (_, i) => ({ state: "working" as const, size: [24, 28, 42, 56][i % 4] })));
    run(100);
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBeGreaterThanOrEqual(18);
    expect(frameRequests).toBeLessThanOrEqual(21);
  });

  it("paints a still mascot with its state's pose and then asks for nothing", () => {
    render([{ state: "sleeping", animated: false, size: 24 }]);
    run(100);
    expect(bodyPath()).toMatch(/^M/);
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("redraws a still mascot when its look changes", () => {
    render([{ state: "idle", animated: false, size: 24, turn: 0 }]);
    run(100);
    const before = eyeTransforms().join("|");
    render([{ state: "idle", animated: false, size: 24, turn: 40 }]);
    run(100);
    expect(eyeTransforms().join("|")).not.toBe(before);
    expect(mascotClock().pending()).toBe(0);
  });

  it("lets a small idle mascot settle to no frames, and wakes it for a blink", () => {
    const ref = createRef<MausAvatarHandle>();
    render([{ state: "idle", size: 24, ref }]);
    run(3000);
    expect(mascotClock().pending()).toBe(0);
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBe(0);
    act(() => ref.current!.blink());
    run(500);
    expect(frameRequests).toBeGreaterThan(5);
    expect(mascotClock().pending()).toBe(0);
  });

  it("shows the notice dot while alerting and hides it when the state clears", () => {
    render([{ state: "notifying", size: 64 }]);
    run(1500);
    const shown = () => [...host.querySelectorAll("svg g")].some((g) => g.getAttribute("display") !== "none" && g.querySelectorAll("circle").length > 0);
    expect(shown()).toBe(true);
    render([{ state: "idle", size: 64 }]);
    run(1500);
    expect(shown()).toBe(false);
  });

  it("lets an unread mascot play its notice, then draws nothing while the news waits", () => {
    function Row({ unread }: { unread: boolean }) {
      return createElement(MausAvatar, { color: "green", state: unread ? "notifying" : "idle", size: 42, animated: useUnreadNotice(unread) });
    }
    act(() => root.render(createElement(Row, { unread: false })));
    run(200);
    act(() => root.render(createElement(Row, { unread: true })));
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBeGreaterThan(20);
    run(UNREAD_NOTICE_MS);
    run(100);
    frameRequests = 0;
    run(30_000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("stops drawing a mascot that leaves the screen", () => {
    render([{ state: "working", size: 36 }]);
    run(200);
    act(() => observed.callback!([{ target: host.querySelector("svg")!, isIntersecting: false }]));
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBe(0);
    act(() => observed.callback!([{ target: host.querySelector("svg")!, isIntersecting: true }]));
    run(500);
    expect(frameRequests).toBeGreaterThan(5);
  });

  it("holds still under reduced motion: no body motion, blinks or spins", () => {
    reducedMotion = true;
    const ref = createRef<MausAvatarHandle>();
    render([{ state: "celebrate", size: 220, ref }]);
    run(200);
    const still = bodyPath();
    run(500);
    expect(bodyPath()).toBe(still);
    frameRequests = 0;
    act(() => { ref.current!.blink(); ref.current!.spin(); });
    run(2000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("calms an animating mascot when reduced motion is switched on", () => {
    render([{ state: "working", size: 36 }]);
    run(200);
    expect(mascotClock().pending()).toBe(1);
    reducedMotion = true;
    act(() => { for (const listener of motionListeners) listener(); });
    run(200);
    expect(mascotClock().pending()).toBe(0);
  });
});
