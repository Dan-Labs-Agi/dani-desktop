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
      <AsciiSkeleton lines={lines} widths={widths} />
    </div>
  );
}

/** ascii-reveal's Reveal exactly as its docs show it: `<AsciiReveal loading={!data} origin="pointer">`. */
export function DecodeIn({ loading, className, children, ...rest }: {
  loading: boolean;
  as?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children"> & DataAttributes) {
  return (
    <AsciiReveal {...rest} loading={loading} origin="pointer" className={cn("decode-in", className)}>
      {children}
    </AsciiReveal>
  );
}
