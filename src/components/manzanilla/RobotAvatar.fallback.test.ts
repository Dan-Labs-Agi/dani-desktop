// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// A display with no WebGL: the renderer constructor throws, as it does on a machine without graphics acceleration.
vi.mock("three", async (original) => ({
  ...(await original<typeof import("three")>()),
  WebGLRenderer: class {
    constructor() {
      throw new Error("Error creating WebGL context.");
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
async function show(size: number): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const { RobotAvatar } = await import("./RobotAvatar");
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(createElement(RobotAvatar, { size, label: "Dani Bot", role: "main" } as never));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return host.querySelector<HTMLElement>("[data-robot-renderer]")!;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("a 3D avatar on a display without WebGL", () => {
  it("shows the unavailable state, never a stuck loader", async () => {
    const avatar = await show(72);
    expect(avatar.getAttribute("data-robot-renderer")).toBe("unavailable");
    expect(avatar.textContent).toContain("3D unavailable");
  });

  it("an avatar created after the first failure is also unavailable", async () => {
    await show(72);
    const later = await show(72);
    expect(later.getAttribute("data-robot-renderer")).toBe("unavailable");
  });

  it("a small avatar drops the caption so it cannot overflow, and keeps the accessible reason", async () => {
    const small = await show(24);
    expect(small.getAttribute("data-robot-renderer")).toBe("unavailable");
    expect(small.querySelector(".mz-robot-placeholder")?.textContent).toBe("");
    expect(small.getAttribute("aria-label")).toContain("3D avatar unavailable");
  });
});
