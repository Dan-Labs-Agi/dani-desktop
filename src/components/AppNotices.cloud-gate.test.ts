// The real cloud boundary: with no configured backend, AppNotices renders none of
// the cloud sales/notice surfaces (trial cards, Pro popup, sign-in notices) even
// when every other trigger (bridges, due notices, offer state) would fire them.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("AppNotices cloud boundary (no configured backend)", () => {
  it("suppresses every cloud bridge behind cloudSignInSurface", () => {
    const source = readFileSync(new URL("./AppNotices.tsx", import.meta.url), "utf8");
    expect(source).toContain("cloudSignInSurface().available");
    const bridgeLines = source.split("\n").filter(line => /window\.ogb\?\.cloud(Account|Plan)/.test(line));
    expect(bridgeLines.length).toBeGreaterThan(0);
    for (const line of bridgeLines) expect(line).toContain("cloudAvailable");
  });

  it("the boundary module ships nothing configured", async () => {
    const { SHIPPED_CLOUD_BACKEND, cloudSignInSurface } = await import("@/lib/cloud-backend");
    expect(SHIPPED_CLOUD_BACKEND).toBeNull();
    const status = cloudSignInSurface();
    expect(status.available).toBe(false);
  });
});
