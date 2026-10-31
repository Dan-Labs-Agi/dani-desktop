import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CursorAvatar } from "@/components/CursorAvatar";
import { MASCOT_BODIES } from "../../shared/mascot-bodies";
import { robotPicture, robotPoseForState, type RobotImage } from "./robot-pictures";

const images: RobotImage[] = ["idle", "working", "waiting", "replied"].flatMap((pose) =>
  [40, 56, 88, 128, 192, 256].map((px) => ({
    color: "blue" as const,
    pose: pose as RobotImage["pose"],
    px,
    url: `/robot/blue-${pose}-${px}.webp`,
  })),
);

describe("Dani robot pictures", () => {
  it("picks the smallest picture with a device pixel for every pixel drawn", () => {
    expect(robotPicture("blue", "idle", 20, 2, images)).toBe("/robot/blue-idle-40.webp");
    expect(robotPicture("blue", "idle", 28, 2, images)).toBe("/robot/blue-idle-56.webp");
    expect(robotPicture("blue", "idle", 96, 2, images)).toBe("/robot/blue-idle-192.webp");
    expect(robotPicture("blue", "idle", 112, 3, images)).toBe("/robot/blue-idle-256.webp");
  });

  it("switches pose with the bot's state", () => {
    expect(robotPicture("blue", "working", 44, 1, images)).toBe("/robot/blue-working-56.webp");
    expect(robotPicture("blue", "replied", 44, 1, images)).toBe("/robot/blue-replied-56.webp");
  });

  it("falls back to idle for a missing pose and to null for a missing color", () => {
    const idleOnly = images.filter((image) => image.pose === "idle");
    expect(robotPicture("blue", "working", 44, 1, idleOnly)).toBe("/robot/blue-idle-56.webp");
    expect(robotPicture("violet", "idle", 44, 1, images)).toBeNull();
  });

  it("maps drawn mascot states onto the rig's four poses", () => {
    expect(robotPoseForState("working")).toBe("working");
    expect(robotPoseForState("thinking")).toBe("working");
    expect(robotPoseForState("listening")).toBe("waiting");
    expect(robotPoseForState("happy")).toBe("replied");
    expect(robotPoseForState("idle")).toBe("idle");
    expect(robotPoseForState("sleeping")).toBe("idle");
  });

  it("draws the picture over the whole avatar frame instead of the body and the face", () => {
    const svg = (picture?: string) => renderToStaticMarkup(createElement(CursorAvatar, { size: 112, silhouette: MASCOT_BODIES.cursor, picture }));
    const withPicture = svg("/robot/blue-idle-256.webp");
    expect(withPicture).toContain('<image href="/robot/blue-idle-256.webp"');
    expect(withPicture).not.toMatch(/fill="url\(#[^)]+-grad\)"/);
    expect(svg()).toMatch(/fill="url\(#[^)]+-grad\)"/);
    expect(svg()).not.toContain("<image");
  });
});
