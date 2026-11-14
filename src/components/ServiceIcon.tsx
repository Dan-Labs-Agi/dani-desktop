import { useState } from "react";
import { cn } from "@/lib/cn";

/** One connectable app as the Apps catalog lists it. */
export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
  categories?: string[];
}

/** Composio serves one logo per app slug (logos.composio.dev, checked 2026-11). */
function composioLogo(slug: string): string {
  return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;
}

/** An app's logo (its own, else Composio's for its slug), then its site's favicon, then its initial. */
export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label"> & { slug?: string }; className?: string }) {
  const logo = card.logo ?? (card.slug ? composioLogo(card.slug) : null);
  const [stage, setStage] = useState(logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && logo) {
    return (
      <img
        src={logo}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary", className)}>
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}
