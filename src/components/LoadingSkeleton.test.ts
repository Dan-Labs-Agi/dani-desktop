import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const reveals = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("ascii-reveal", () => ({
  AsciiSkeleton: () => h("span", { className: "ars" }),
  AsciiReveal: ({ children, ...props }: Record<string, unknown> & { children?: unknown }) => {
    reveals.push(props);
    return h("div", { "data-reveal": "" }, children as never);
  },
}));
import { DecodeIn, LoadingSkeleton } from "./LoadingSkeleton";

describe("LoadingSkeleton", () => {
  it("is a status whose label screen readers hear, over ascii-reveal's skeleton", () => {
    const html = renderToStaticMarkup(h(LoadingSkeleton, { label: "Loading logins", "data-logins": "" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('<span class="sr-only">Loading logins</span>');
    expect(html).toContain('class="ars"');
    expect(html).toContain("data-logins");
  });
});

describe("DecodeIn", () => {
  it("is ascii-reveal's AsciiReveal exactly as its docs show it, around AsciiSkeleton", () => {
    reveals.length = 0;
    const html = renderToStaticMarkup(h(DecodeIn, { loading: true, className: "flex", "data-plan": "loading" },
      h(LoadingSkeleton, { label: "Loading" })));
    expect(html).toContain('class="ars"');
    expect(reveals).toEqual([{ loading: true, origin: "pointer", className: "decode-in flex", "data-plan": "loading" }]);
    reveals.length = 0;
    renderToStaticMarkup(h(DecodeIn, { loading: false }, h("p", null, "Pro plan")));
    expect(reveals).toEqual([{ loading: false, origin: "pointer", className: "decode-in" }]);
  });
});
