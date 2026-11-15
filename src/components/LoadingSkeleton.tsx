import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { AsciiReveal, AsciiSkeleton } from "ascii-reveal";

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

/** ascii-reveal's Reveal as its docs page runs it: while `loading` the skeleton inside is left alone, and when it turns
 *  false the content that replaced it decodes in at once. `preset` is its glyph set, `from` where the wave starts. */
export function DecodeIn({ loading, preset = "decode", from = "center", className, children, ...rest }: {
  loading: boolean;
  preset?: "decode" | "terminal";
  from?: "center" | "top";
  as?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children"> & DataAttributes) {
  return (
    <AsciiReveal {...rest} loading={loading} preset={preset} origin={from === "top" ? "top-left" : "center"} revealOnMount={false} lazy={false} className={cn("decode-in", className)}>
      {children}
    </AsciiReveal>
  );
}
