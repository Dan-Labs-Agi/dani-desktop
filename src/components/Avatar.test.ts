// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BotAvatar,
  MausAvatar,
  resolveBotAvatarOutcome,
  type BotAvatarProps,
} from "./Avatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";
import { BLOUB_SHAPE } from "./bloub-adapter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Mount with fake timers and let the shared clock draw one frame. */
function mount(element: Parameters<typeof createElement>[1] extends never ? never : ReturnType<typeof createElement>) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  act(() => { vi.advanceTimersByTime(200); });
  return { host, root };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const renderBot = (bot: Partial<BotAvatarProps["bot"]>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false }),
  );

describe("MausAvatar body", () => {
  it("maps every mascot body onto a Bloub silhouette", () => {
    for (const id of Object.keys(MASCOT_BODIES)) expect(id in BLOUB_SHAPE).toBe(true);
    expect(BLOUB_SHAPE.squircle).toBe("squircle");
    expect(BLOUB_SHAPE.hexagon).toBe("hexagone");
  });

  it("draws the Dani character for the body it is given", () => {
    const { host } = mount(createElement(MausAvatar, { color: "green", animated: false, bodyId: "star" }));
    const body = host.querySelector("svg path")!;
    expect(body.getAttribute("d")).toMatch(/^M/);
    expect(body.getAttribute("fill")).toMatch(/^#/);
  });

  it("paints the body with the per-bot color, never a flat black fill", () => {
    const { host } = mount(createElement(MausAvatar, { color: "green", animated: false, bodyId: "circle" }));
    const body = host.querySelector("svg path")!;
    expect(body.getAttribute("fill")).not.toBe("#000000");
    expect(body.getAttribute("fill")).toMatch(/^#/);
  });
});

describe("mascot facial feature colors", () => {
  it.each(["white", "black"] as const)("uses %s eyes on every Dani body type", (mascotFaceColor) => {
    const ink = mascotFaceColor === "white" ? "#ffffff" : "#000000";
    for (const mascotBody of ["circle", "star"] as const) {
      for (const color of ["green", "chrome"] as const) {
        const { host, root } = mount(createElement(MausAvatar, { color, bodyId: mascotBody, faceColor: mascotFaceColor, animated: false }));
        const eyes = [...host.querySelectorAll("svg g path")].filter((p) => p.getAttribute("fill") === ink);
        expect(eyes.length).toBeGreaterThan(0);
        act(() => root.unmount());
      }
    }
  });

  it("keeps default inks when an override is reset or comes from an older profile", () => {
    const { host } = mount(createElement(MausAvatar, { color: "green", bodyId: "pumpkin", animated: false }));
    expect(host.innerHTML).toContain('stroke="#0d0a10"');
    const { host: plain } = mount(createElement(MausAvatar, { color: "green", faceColor: null, animated: false }));
    const eyes = [...plain.querySelectorAll("svg g path")].filter((p) => p.getAttribute("fill") === "#0a0a0c");
    expect(eyes.length).toBeGreaterThan(0);
  });

  it("renders Dani for the Chief of Staff, a color variant for any other bot", () => {
    const { host } = mount(createElement(BotAvatar, { bot: { color: "green", name: "Chief of Staff" }, animated: false }));
    expect(host.querySelector("[data-robot-role]")!.getAttribute("data-robot-role")).toBe("dani");
    expect(host.querySelector("canvas")).not.toBeNull();
    const { host: other } = mount(createElement(BotAvatar, { bot: { color: "blue", name: "Scout" }, animated: false }));
    expect(other.querySelector("[data-robot-role]")!.getAttribute("data-robot-role")).toBe("tuft");
  });

  it("does not paint features over an uploaded image", () => {
    const markup = renderBot({ mascotFaceColor: "black", avatarUrl: "/api/attachments/photo.png", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });
});

describe("BotAvatar's two avatar outcomes", () => {
  it("zooms and positions a custom image inside its crop", () => {
    const markup = renderBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 2,
      avatarFocusX: 0.25,
      avatarFocusY: 0.75,
    });
    expect(markup).toContain("scale(2)");
    expect(markup).toContain("25% 75%");
    expect(markup).toContain("border-radius:50%");
  });

  it("renders a flat cropped image for circle/rounded/square, with no mascot at all", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });

  it("shows the image as it is, with no mascot face painted on it", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "square" });
    expect(markup).toContain("border-radius:0");
    expect(markup).toContain("<img");
    expect(markup).not.toContain("<image");
    expect(markup).not.toContain("radialGradient");
  });

  it("renders the robot character when the crop is mascot, image or not", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "mascot" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("mz-robot-avatar");
  });

  it("falls back to the robot character when a flat crop has no valid image", () => {
    const markup = renderBot({ avatarUrl: undefined, avatarCrop: "circle" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("mz-robot-avatar");
  });
});

describe("resolveBotAvatarOutcome", () => {
  // imageFailed is set by the <img>'s onError, which renderToStaticMarkup never fires, so the decision is a pure
  // function.
  it("falls back to the gradient mascot for an image that failed to load", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "circle", hasUrl: true, imageFailed: true }),
    ).toBe("gradientMascot");
  });

  it("renders a good flat image flat", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "rounded", hasUrl: true, imageFailed: false }),
    ).toBe("flatImage");
  });

  it("keeps the mascot crop on the gradient mascot even with a loaded image", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "mascot", hasUrl: true, imageFailed: false }),
    ).toBe("gradientMascot");
  });

  it("falls back to the gradient mascot when there is no image at all", () => {
    expect(
      resolveBotAvatarOutcome({ avatarCrop: "square", hasUrl: false, imageFailed: false }),
    ).toBe("gradientMascot");
  });
});
