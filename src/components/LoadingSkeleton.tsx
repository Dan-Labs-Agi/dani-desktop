import { AsciiSkeleton } from "ascii-reveal";

import { cn } from "@/lib/cn";

/** Content still loading: ascii-reveal's glyph skeleton in the shape of `lines` rows of text. The skeleton is hidden
 *  from screen readers, so `label` is what they hear. */
export function LoadingSkeleton({ label, lines = 3, widths, className, ...rest }: {
  label: string;
  lines?: number;
  widths?: string[];
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div {...rest} role="status" aria-label={label} title={label} className={cn("text-[13px] text-ink-tertiary", className)}>
      <AsciiSkeleton variant="dither" lines={lines} widths={widths} />
    </div>
  );
}
