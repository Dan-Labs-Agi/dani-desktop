import { useLayoutEffect, useRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { AsciiSkeleton, createAsciiReveal } from "ascii-reveal";

import { cn } from "@/lib/cn";

type DataAttributes = Record<`data-${string}`, string | undefined>;

/** Content still loading: ascii-reveal's glyph skeleton in the shape of `lines` rows of text. The skeleton is hidden
 *  from screen readers, so `label` is what they hear. */
export function LoadingSkeleton({ label, lines = 3, widths, className, ...rest }: {
  label: string;
  lines?: number;
  widths?: string[];
  className?: string;
} & DataAttributes) {
  return (
    <div {...rest} role="status" className={cn("loading-skeleton text-[13px] text-ink-secondary", className)}>
      <span className="sr-only">{label}</span>
      <AsciiSkeleton variant="dither" lines={lines} widths={widths} />
    </div>
  );
}

const DECODING = "data-decoding";
const DECODE_LIMIT_MS = 1500;
// ascii-reveal ec413f4 hides what it is decoding with these attributes and draws in an `.ar-overlay` child.
const ENGINE_HOLDS = ["data-ar-t", "data-ar-tc", "data-ar-m", "data-ar-s", "data-ar-f"];

type DecodeLook = {
  /** ascii-reveal's glyph set: `decode` condenses into the text, `terminal` types it behind a cursor. */
  preset?: "decode" | "terminal";
  /** Where the wave starts in the box. */
  from?: "center" | "top";
};

/** Decodes the text of `arrivals` in through ascii-reveal's character grid; pictures are left as they are. The
 *  engine measures once, so the decode ends at once when anything in the box scrolls, and it ends when it runs long.
 *  Returns how to end it early. However it ends, the arrivals are showing and nothing of the decode stays on the
 *  page, whatever state the engine is in. */
function decode(box: HTMLElement, arrivals: Element[], { preset = "decode", from = "center" }: DecodeLook): () => void {
  let reveal: ReturnType<typeof createAsciiReveal> | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(limit);
    box.removeEventListener("scroll", end, true);
    try {
      reveal?.destroy();
    } finally {
      for (const element of arrivals) element.removeAttribute(DECODING);
      for (const held of box.querySelectorAll<HTMLElement>(ENGINE_HOLDS.map((name) => `[${name}]`).join(","))) {
        for (const name of ENGINE_HOLDS) held.removeAttribute(name);
        held.style.removeProperty("--ar-o");
      }
      for (const overlay of box.querySelectorAll(":scope > .ar-overlay")) overlay.remove();
    }
  };
  const limit = setTimeout(end, DECODE_LIMIT_MS);
  box.addEventListener("scroll", end, true);
  try {
    for (const element of arrivals) element.setAttribute(DECODING, "");
    reveal = createAsciiReveal(box, { preset, selector: `[${DECODING}]`, media: "[data-decode-media]", lazy: false });
    const { left, top, width } = box.getBoundingClientRect();
    reveal.reveal({ within: box, origin: from === "center" ? "center" : { x: left + width / 2, y: Math.max(top, 0) } }).then(end, end);
  } catch {
    end();
  }
  return end;
}

/** A box that decodes in the text of the elements that appear in it when `loading` turns false. Whatever was already
 *  showing stays as it is. While a decode runs the box ends in ascii-reveal's overlay element, so its last real
 *  child is not `:last-child`. */
export function DecodeIn({ loading, preset, from, as: Box = "div", className, children, ...rest }: DecodeLook & {
  loading: boolean;
  as?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children"> & DataAttributes) {
  const box = useRef<HTMLElement>(null);
  const wasLoading = useRef(loading);
  const shown = useRef<Set<Element>>(new Set());
  const end = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const arrived = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (loading) { shown.current = new Set(element.querySelectorAll("*")); return; }
    if (!arrived) return;
    const before = shown.current;
    shown.current = new Set();
    const arrivals = [...element.querySelectorAll("*")].filter((child) => !before.has(child) && (child.parentElement === element || before.has(child.parentElement!)));
    end.current?.();
    end.current = null;
    if (!arrivals.length || document.hidden) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      for (const child of arrivals) child.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      return;
    }
    end.current = decode(element, arrivals, { preset, from });
  });
  useLayoutEffect(() => () => end.current?.(), []);
  return <Box ref={box} aria-busy={loading || undefined} {...rest} className={cn("decode-in relative", className)}>{children}</Box>;
}
