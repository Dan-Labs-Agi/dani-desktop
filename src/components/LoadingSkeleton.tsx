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
const DECODE_START_LIMIT_MS = 300;
const DECODE_LIMIT_MS = 1500;

/** Decodes `arrivals` in through ascii-reveal's character grid, which measures them once: so it starts after the
 *  frame in which the arrivals' own effects have placed and scrolled them, and it ends at once when anything in the
 *  box scrolls, when those frames do not come, or when it runs long. Returns how to end it early; however it ends, the
 *  arrivals are left showing and nothing of the decode stays on the page. */
function decode(box: HTMLElement, arrivals: Element[]): () => void {
  for (const element of arrivals) element.setAttribute(DECODING, "");
  const reveal = createAsciiReveal(box, { preset: "decode", selector: `[${DECODING}]`, lazy: false });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    clearTimeout(startLimit);
    clearTimeout(limit);
    box.removeEventListener("scroll", end, true);
    reveal.destroy();
    for (const element of arrivals) element.removeAttribute(DECODING);
  };
  const startLimit = setTimeout(end, DECODE_START_LIMIT_MS);
  const limit = setTimeout(end, DECODE_LIMIT_MS);
  reveal.hide({ instant: true }).catch(end);
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      clearTimeout(startLimit);
      box.addEventListener("scroll", end, true);
      reveal.reveal({ within: box }).then(end, end);
    });
  });
  return end;
}

/** A box that decodes in the elements that appear in it when `loading` turns false. Whatever was already showing
 *  stays as it is, and so does everything under `data-ascii="skip"`. `once`: only the first arrival decodes. While a
 *  decode runs the box ends in ascii-reveal's overlay element, so its last real child is not `:last-child`. */
export function DecodeIn({ loading, once, as: Box = "div", className, children, ...rest }: {
  loading: boolean;
  once?: boolean;
  as?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children"> & DataAttributes) {
  const box = useRef<HTMLElement>(null);
  const wasLoading = useRef(loading);
  const decoded = useRef(false);
  const shown = useRef<Set<Element>>(new Set());
  const end = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const arrived = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (loading) { shown.current = new Set(element.querySelectorAll("*")); return; }
    if (!arrived || (once && decoded.current)) return;
    decoded.current = true;
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
    end.current = decode(element, arrivals);
  });
  useLayoutEffect(() => () => end.current?.(), []);
  return <Box ref={box} aria-busy={loading || undefined} {...rest} className={cn("relative", className)}>{children}</Box>;
}
