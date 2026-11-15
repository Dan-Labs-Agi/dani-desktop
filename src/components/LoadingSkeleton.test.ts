// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine = vi.hoisted(() => ({ made: [] as { preset: string }[], destroyed: 0, breaks: false }));
vi.mock("ascii-reveal", () => ({
  AsciiSkeleton: () => h("span", { className: "ars" }),
  createAsciiReveal: (_box: HTMLElement, options: { preset: string }) => {
    engine.made.push(options);
    return {
      reveal: () => new Promise(() => {}),
      destroy: () => { engine.destroyed += 1; if (engine.breaks) throw new Error("engine broke"); },
    };
  },
}));
import { DecodeIn, LoadingSkeleton } from "./LoadingSkeleton";

let root: Root;
let container: HTMLElement;
const show = (loading: boolean, rows: string[]) => act(() => root.render(h(DecodeIn, { loading, preset: "terminal" },
  h("p", { id: "always" }, "Saved logins"),
  loading && h(LoadingSkeleton, { label: "Loading" }),
  h("ul", { id: "list" }, rows.map((row) => h("li", { key: row, id: row }, h("span", { id: `${row}-name` }, row)))))));
const decoding = () => [...container.querySelectorAll("[data-decoding]")].map((element) => element.id);
const runOut = () => vi.advanceTimersByTime(1500);

beforeEach(() => {
  vi.useFakeTimers();
  engine.made.length = 0;
  engine.destroyed = 0;
  engine.breaks = false;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DecodeIn", () => {
  it("decodes what arrives when loading ends, and nothing that was already showing", () => {
    show(true, []);
    expect(container.firstElementChild!.getAttribute("aria-busy")).toBe("true");
    expect(decoding()).toEqual([]);
    show(false, ["github.com", "linear.app"]);
    expect(decoding()).toEqual(["github.com", "linear.app"]);
    expect(engine.made).toMatchObject([{ preset: "terminal" }]);
    expect(container.firstElementChild!.hasAttribute("aria-busy")).toBe(false);
  });

  it("leaves alone content that is there from the start or that arrives later", () => {
    show(false, ["github.com"]);
    show(false, ["github.com", "linear.app"]);
    expect(decoding()).toEqual([]);
    expect(engine.made).toEqual([]);
  });

  it("clears a decode away when it runs long, when the next one starts and when the box goes", () => {
    show(true, []);
    show(false, ["github.com"]);
    runOut();
    expect(engine.destroyed).toBe(1);
    expect(decoding()).toEqual([]);

    show(true, ["github.com"]);
    show(false, ["github.com", "linear.app"]);
    expect(decoding()).toEqual(["linear.app"]);
    show(true, ["github.com", "linear.app"]);
    show(false, ["github.com", "linear.app", "figma.com"]);
    expect(decoding()).toEqual(["figma.com"]);
    expect(engine.destroyed).toBe(2);
    act(() => root.unmount());
    expect(engine.destroyed).toBe(3);
    root = createRoot(container);
  });

  it("leaves the arrivals showing and nothing of the decode behind, even when the engine breaks", () => {
    show(true, []);
    show(false, ["github.com"]);
    const box = container.firstElementChild!;
    const name = document.getElementById("github.com-name") ?? container.querySelector("li span")!;
    name.setAttribute("data-ar-t", "");
    box.append(Object.assign(document.createElement("div"), { className: "ar-overlay" }));
    engine.breaks = true;
    expect(runOut).toThrow("engine broke");
    expect(name.hasAttribute("data-ar-t")).toBe(false);
    expect(box.querySelector(".ar-overlay")).toBeNull();
    expect(decoding()).toEqual([]);
  });

  it("fades the arrivals in instead when the person asked for less motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    const animate = vi.fn();
    const original = Element.prototype.animate;
    Element.prototype.animate = animate as never;
    try {
      show(true, []);
      show(false, ["github.com"]);
      expect(engine.made).toEqual([]);
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.animate = original;
    }
  });
});
