import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveAddressBarInput } from "@/lib/browser-address";
import { BrowserStartPage, START_SITES } from "./StartPage";

describe("a blank tab's start page", () => {
  it("offers a search box and each site as a button, with nothing fetched from anywhere", () => {
    const html = renderToStaticMarkup(createElement(BrowserStartPage, { onOpen: () => {} }));
    expect(html).toContain('placeholder="Search or enter address"');
    expect(html.match(/<button/g)).toHaveLength(START_SITES.length);
    expect(html).not.toMatch(/<img|<iframe|src=|href=/);
  });

  it("opens every site over https through the address bar's own rules, never a local address", () => {
    for (const site of START_SITES) {
      const url = resolveAddressBarInput(site.address);
      expect(url, site.name).toMatch(/^https:\/\/[a-z.]+\/$/);
      expect(url, site.name).not.toMatch(/127\.0\.0\.1|localhost/);
    }
  });

  it("searches for words and adds https to a bare domain", () => {
    expect(resolveAddressBarInput("best pizza near me")).toBe("https://duckduckgo.com/?q=best%20pizza%20near%20me");
    expect(resolveAddressBarInput("google.com")).toBe("https://google.com/");
  });
});
