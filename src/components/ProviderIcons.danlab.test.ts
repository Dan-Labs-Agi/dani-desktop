import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DanLabMark, ProviderMark } from "./ProviderIcons";

describe("the Dan Lab provider mark", () => {
  it("renders the authoritative black-on-white mark for the daniFree driver", () => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { driverKind: "daniFree" }));
    expect(html).toContain("svg");
    expect(html).toContain('fill="#000000"');
    expect(html).toContain('fill="#dcdcdc"');
  });
  it("scales with size", () => {
    const html = renderToStaticMarkup(createElement(DanLabMark, { size: 32 }));
    expect(html).toContain('width="32"');
  });
});
