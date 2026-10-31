// The real cloud boundary: with no owned backend, the one-click sign-in
// button is replaced by an honest local-only notice; the explicitly
// user-entered custom-address form stays available.
import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], updating: false }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (fixture.values.length <= index) fixture.values.push(initial);
    return [fixture.values[index], (next: unknown) => { fixture.values[index] = next instanceof Function ? next(fixture.values[index]) : next; }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
}));

import { OrganizationSettings } from "./OrganizationSettings";

const organization = {
  state: () => Promise.resolve({ status: "signed-out", models: [], message: null }),
  onState: () => () => {},
  beginEnrollment: () => Promise.resolve({ ok: true }),
  cancelEnrollment: () => Promise.resolve({ ok: true }),
  disconnect: () => Promise.resolve({ ok: true }),
  refreshModels: () => Promise.resolve({ ok: true }),
};

function render() {
  fixture.index = 0; fixture.effects = [];
  return renderToStaticMarkup(createElement(OrganizationSettings));
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe("Organization cloud boundary (no owned backend)", () => {
  beforeEach(() => { fixture.values = []; fixture.index = 0; fixture.effects = []; setLocale("en"); });
  afterEach(() => { setLocale("en"); });

  it("shows the honest notice instead of a one-click sign-in button", async () => {
    vi.stubGlobal("window", { ogb: { organization } });
    render(); fixture.effects[0](); await flush();
    const html = render();
    expect(html).not.toContain("Sign in with your organization");
    expect(html).toContain("no cloud service of its own");
    expect(html).toContain("upstream OpenMausBot project");
    expect(html).not.toContain("OpenMausBot Cloud");
  });
});
