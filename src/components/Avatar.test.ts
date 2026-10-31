import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BotAvatar,
  MausAvatar,
  resolveBotAvatarOutcome,
  type BotAvatarProps,
  type MausAvatarProps,
} from "./Avatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";

const render = (props: Partial<MausAvatarProps>) =>
  renderToStaticMarkup(createElement(MausAvatar, { color: "green", animated: false, ...props }));

const renderBot = (bot: Partial<BotAvatarProps["bot"]>) =>
  renderToStaticMarkup(
    createElement(BotAvatar, { bot: { color: "green", ...bot }, animated: false }),
  );

describe("MausAvatar body", () => {
  it("wears the Manzanilla robot for every body and color", () => {
    for (const bodyId of [undefined, "star", "pumpkin", "vampire", "circle"] as const) {
      for (const color of ["green", "chrome", "purple", "red"] as const) {
        const markup = render({ bodyId, color });
        expect(markup).toContain("mz-robot-avatar");
        expect(markup).not.toContain("/src/assets/dani-robot/");
        expect(markup).not.toContain("<svg");
      }
    }
  });

  it("wears the requested dani-dex character, defaulting to name inference", () => {
    expect(render({ robotRole: "chief" })).toContain('data-robot-role="chief"');
    expect(render({ robotRole: "builder" })).toContain('data-robot-role="builder"');
    expect(render({ label: "Invoice Collector" })).toContain('data-robot-role="invoice"');
  });

  it("switches the robot's motion with the bot's state", () => {
    expect(render({ state: "working" })).toContain('data-robot-motion="working"');
    expect(render({ state: "listening" })).toContain('data-robot-motion="waiting"');
    expect(render({ state: "happy" })).toContain('data-robot-motion="idle"');
  });

  it("renders the robot even when a saved face-color override exists", () => {
    // The drawn-mascot face-ink preference is kept in the profile, but the old
    // mascot never renders: the Dani robot is the only character.
    const markup = renderBot({ mascotFaceColor: "black" });
    expect(markup).toContain("mz-robot-avatar");
    expect(markup).not.toContain("/src/assets/dani-robot/");
  });

  it("does not paint features over an uploaded image", () => {
    const markup = renderBot({ mascotFaceColor: "black", avatarUrl: "/api/attachments/photo.png", avatarCrop: "circle" });
    expect(markup).toContain("<img");
    expect(markup).not.toContain('dani-robot');
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

  it("renders the robot when the crop is mascot, image or not", () => {
    const markup = renderBot({ avatarUrl: "/api/attachments/cat.webp", avatarCrop: "mascot" });
    expect(markup).not.toContain("<img");
    expect(markup).toContain("mz-robot-avatar");
  });

  it("gives a bot its dani-dex character", () => {
    expect(renderBot({ name: "Talent Scout" })).toContain('data-robot-role="talent"');
    expect(renderBot({ readyBotId: "coder" })).toContain('data-robot-role="builder"');
    expect(renderBot({ chiefOfStaff: true })).toContain('data-robot-role="chief"');
  });

  it("falls back to the robot when a flat crop has no valid image", () => {
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
