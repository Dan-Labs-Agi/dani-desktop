// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarInstance } from "./robot-avatar-engine";

vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: class { constructor() { throw new Error("test WebGL unavailable"); } },
}));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function avatar(): AvatarInstance {
  const element = document.createElement("span");
  element.getBoundingClientRect = () => ({ x: 0, y: 0, width: 64, height: 64, top: 0, bottom: 64, left: 0, right: 64, toJSON() {} });
  return { element, canvas: document.createElement("canvas"), context: {} as CanvasRenderingContext2D,
    size: 64, role: "chief", color: "#9561ED", motion: "idle", animated: false, seed: 1,
    visible: true, dirty: true, ready: false, waveStarted: null, motionStarted: null, motionCompleted: false,
    onReady: vi.fn(), onFailure: vi.fn() };
}

describe("shared renderer failure state", () => {
  it("reports a failed shared renderer to later avatars and retries after full teardown", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    const { registerAvatar } = await import("./robot-avatar-engine");
    const first = avatar(); const stopFirst = registerAvatar(first);
    await vi.advanceTimersByTimeAsync(32);
    expect(first.onFailure).toHaveBeenCalledWith("3D renderer could not start: test WebGL unavailable");
    stopFirst();
    // Chief dialog mounts before the renderer's eight-second idle teardown.
    const chief = avatar(); const stopChief = registerAvatar(chief);
    expect(chief.onFailure).toHaveBeenCalledWith("3D renderer could not start: test WebGL unavailable");
    stopChief();
    await vi.advanceTimersByTimeAsync(8_001);
    const fresh = avatar(); const stopFresh = registerAvatar(fresh);
    expect(fresh.onFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(32);
    expect(fresh.onFailure).toHaveBeenCalledWith("3D renderer could not start: test WebGL unavailable");
    stopFresh(); await vi.advanceTimersByTimeAsync(8_001);
  });
});
