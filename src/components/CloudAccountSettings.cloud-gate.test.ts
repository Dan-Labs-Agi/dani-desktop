// The real cloud boundary: with no configured backend the Cloud settings section
// shows only the honest local notice - no sign-in button, no loading state, no
// sales surface - even when the desktop bridge exists and would answer.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const bridge = {
  state: () => Promise.resolve({ status: "signed-out", models: [], message: null }),
  onState: () => () => {},
  begin: () => Promise.resolve({ ok: true }),
};

describe("CloudAccountSettings cloud boundary (no configured backend)", () => {
  beforeEach(() => { setLocale("en"); });

  it("renders the honest notice and nothing actionable", async () => {
    vi.stubGlobal("window", { ogb: { cloudAccount: bridge } });
    const { CloudAccountSettings } = await import("./CloudAccountSettings");
    const html = renderToStaticMarkup(createElement(CloudAccountSettings));
    expect(html).toContain("no cloud service configured");
    expect(html).toContain("upstream OpenMausBot project");
    expect(html).not.toContain("cloudAccount.signIn");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Add a Cloud");
    expect(html).not.toContain("loading");
  });
});
