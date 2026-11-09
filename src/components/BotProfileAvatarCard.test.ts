import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Dani",
    title: "Dani",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function renderCard(bot: Bot) {
  return renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(BotProfileAvatarCard, {
        bot,
        activeState: "idle",
        mascotMotion: null,
        onPatch: vi.fn(),
      }),
    ),
  );
}

describe("BotProfileAvatarCard character picker", () => {
  it("renders one option per Dani character, labeled by name", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain(">Look<");
    for (const label of ["Dani", "Sprout", "Tuft", "Sweep", "Cap", "Shades", "Bow"]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
  });

  it("marks the bot's own character pressed and the rest unpressed", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain('aria-pressed="true" aria-label="Sweep"');
    expect(markup).toContain('aria-pressed="false" aria-label="Dani"');
  });

  it("reflects an explicitly chosen character colour", () => {
    const markup = renderCard(makeBot({ color: "pink" }));

    expect(markup).toContain('aria-pressed="true" aria-label="Bow"');
    expect(markup).toContain('aria-pressed="false" aria-label="Sweep"');
  });

  it("offers zoom and drag framing for a custom image", () => {
    const markup = renderCard(makeBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 1.5,
    }));
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    const markup = renderCard(makeBot());
    expect(markup).not.toContain('aria-label="Zoom avatar"');
  });

  it("hides the character picker for flat crops that have no mascot to show", () => {
    const markup = renderCard(makeBot({ avatarCrop: "circle" }));

    expect(markup).not.toContain(">Look<");
    expect(markup).not.toContain(`aria-label="Sprout"`);
  });

  it("hides the character picker for every flat crop, not just circle", () => {
    for (const crop of ["rounded", "square"] as const) {
      const markup = renderCard(makeBot({ avatarCrop: crop }));

      expect(markup).not.toContain(">Look<");
    }
  });
});
