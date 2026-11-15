// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine = vi.hoisted(() => ({ decodes: [] as string[][], destroyed: 0 }));
vi.mock("ascii-reveal", () => ({
  AsciiSkeleton: () => h("span", { className: "ars" }),
  createAsciiReveal: (box: HTMLElement, { selector }: { selector: string }) => ({
    hide: () => { engine.decodes.push([...box.querySelectorAll(selector)].map((element) => element.id)); return Promise.resolve(); },
    reveal: () => new Promise(() => {}),
    destroy: () => { engine.destroyed += 1; },
  }),
}));
import { DecodeIn, LoadingSkeleton } from "./LoadingSkeleton";

let root: Root;
let container: HTMLElement;
const show = (loading: boolean, rows: string[], once = false) => act(() => root.render(h(DecodeIn, { loading, once },
  h("p", { id: "always" }, "Saved logins"),
  loading && h(LoadingSkeleton, { label: "Loading" }),
  h("ul", { id: "list" }, rows.map((row) => h("li", { key: row, id: row }, h("span", { id: `${row}-name` }, row)))))));

const decodes = engine.decodes;
beforeEach(() => {
  decodes.length = 0;
  engine.destroyed = 0;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe("DecodeIn", () => {
  it("decodes what arrives when loading ends, and nothing that was already showing", () => {
    show(true, []);
    expect(container.firstElementChild!.getAttribute("aria-busy")).toBe("true");
    expect(decodes).toEqual([]);
    show(false, ["github.com", "linear.app"]);
    expect(decodes).toEqual([["github.com", "linear.app"]]);
    expect(container.firstElementChild!.hasAttribute("aria-busy")).toBe(false);
  });

  it("clears a decode away when it runs long and when the box goes", () => {
    vi.useFakeTimers();
    try {
      show(true, []);
      show(false, ["github.com"]);
      expect(container.querySelectorAll("[data-decoding]")).toHaveLength(1);
      vi.advanceTimersByTime(1500);
      expect(engine.destroyed).toBe(1);
      expect(container.querySelector("[data-decoding]")).toBeNull();

      show(true, ["github.com"]);
      show(false, ["github.com", "linear.app"]);
      act(() => root.unmount());
      expect(engine.destroyed).toBe(2);
      root = createRoot(container);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves alone content that is there from the start or that arrives later", () => {
    show(false, ["github.com"]);
    show(false, ["github.com", "linear.app"]);
    expect(decodes).toEqual([]);
  });

  it("decodes each arrival, or only the first when asked to", () => {
    show(true, []);
    show(false, ["github.com"]);
    show(true, ["github.com"]);
    show(false, ["github.com", "linear.app"]);
    expect(decodes).toEqual([["github.com"], ["linear.app"]]);

    act(() => root.unmount());
    root = createRoot(container);
    decodes.length = 0;
    show(true, [], true);
    show(false, ["github.com"], true);
    show(true, ["github.com"], true);
    show(false, ["github.com", "linear.app"], true);
    expect(decodes).toEqual([["github.com"]]);
  });

  it("fades the arrivals in instead when the person asked for less motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    const animate = vi.fn();
    const original = Element.prototype.animate;
    Element.prototype.animate = animate as never;
    try {
      show(true, []);
      show(false, ["github.com"]);
      expect(decodes).toEqual([]);
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.animate = original;
      vi.unstubAllGlobals();
    }
  });
});
