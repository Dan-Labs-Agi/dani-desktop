import type { ReactNode } from "react";
import { AsciiSkeleton } from "ascii-reveal";

const Lines = ({ widths, seed }: { widths: string[]; seed: number }) => <AsciiSkeleton variant="dither" lines={widths.length} widths={widths} seed={seed} className="min-w-0 flex-1" />;

const Bubble = ({ width, seed }: { width: string; seed: number }) => (
  <div className="ms-auto rounded-2xl bg-ink/[0.08] px-4 py-3" style={{ width }}><Lines widths={["100%"]} seed={seed} /></div>
);

const Bullet = ({ widths, seed }: { widths: string[]; seed: number }) => (
  <div className="flex gap-2.5 ps-1">
    <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-current opacity-40" />
    <Lines widths={widths} seed={seed} />
  </div>
);

const Heading = ({ width, seed }: { width: string; seed: number }) => <div className="pt-1 text-ink"><Lines widths={[width]} seed={seed} /></div>;

/** The chat while the bots load: its header, a turn from each side and the composer, in ascii-reveal skeletons.
 *  The skeletons are hidden from screen readers, so `label` is what they hear. */
export function ChatSkeleton({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div role="status" className="loading-skeleton relative flex h-full min-h-0 w-full flex-col text-[15px] text-ink-secondary">
      <span className="sr-only">{label}</span>
      <div className="flex h-12 shrink-0 items-center gap-2.5 px-4 text-[13px]">
        <AsciiSkeleton variant="dither" rows={2} width={22} height={22} circle seed={1} />
        <div className="w-16"><Lines widths={["100%"]} seed={2} /></div>
        <div className="w-24 rounded-md bg-ink/[0.06] px-2 py-1"><Lines widths={["100%"]} seed={3} /></div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-5">
        <div className="chat-column flex flex-col gap-5 pt-4">
          <Bubble width="8rem" seed={4} />
          <div className="flex max-w-[var(--chat-prose-max)] flex-col gap-3 pe-[12%]">
            <Lines widths={["62%"]} seed={5} />
            <Lines widths={["96%", "38%"]} seed={6} />
            <Heading width="16%" seed={7} />
            <Bullet widths={["98%", "94%", "90%", "70%"]} seed={8} />
            <Bullet widths={["92%", "46%"]} seed={9} />
            <Heading width="20%" seed={10} />
            <Bullet widths={["96%", "52%"]} seed={11} />
            <Heading width="22%" seed={12} />
            <Bullet widths={["94%", "30%"]} seed={13} />
          </div>
          <Bubble width="10rem" seed={14} />
          <Lines widths={["26%"]} seed={15} />
        </div>
      </div>
      <div className="chat-column-dock w-full shrink-0 px-5 pb-5 text-[13px]">
        {children}
        <div className="flex h-12 items-center gap-3 rounded-[22px] bg-composer px-4">
          <span className="text-[18px] leading-none opacity-50">+</span>
          <div className="w-28"><Lines widths={["100%"]} seed={16} /></div>
        </div>
      </div>
    </div>
  );
}

/** The sidebar's thread rows while the bots load; the chat's skeleton carries the status for screen readers. */
export function ThreadRowsSkeleton() {
  return (
    <div aria-hidden="true" className="loading-skeleton flex flex-col gap-1 text-[13px] text-ink-secondary">
      {[1, 2].map((n) => (
        <div key={n} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
          <AsciiSkeleton variant="dither" rows={3} width={32} height={32} circle seed={20 + n} />
          <Lines widths={n === 1 ? ["40%", "80%"] : ["32%", "70%"]} seed={30 + n} />
        </div>
      ))}
    </div>
  );
}
