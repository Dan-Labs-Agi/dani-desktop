import { useState } from "react";
import { Search } from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";

/** The sites a blank tab offers. Each opens by its address, as if typed in the address bar. `slug` is the Composio app
 * whose logo it shows; logos.composio.dev has none of its own for Wikipedia (checked 2026-11), which shows its initial. */
export const START_SITES: readonly { name: string; address: string; slug?: string }[] = [
  { name: "Google", address: "google.com", slug: "google_search" },
  { name: "YouTube", address: "youtube.com", slug: "youtube" },
  { name: "Gmail", address: "mail.google.com", slug: "gmail" },
  { name: "GitHub", address: "github.com", slug: "github" },
  { name: "Wikipedia", address: "wikipedia.org" },
  { name: "Reddit", address: "reddit.com", slug: "reddit" },
  { name: "X", address: "x.com", slug: "twitter" },
  { name: "LinkedIn", address: "linkedin.com", slug: "linkedin" },
];

/** A blank tab's start page: a search box and a few common sites. Drawn by the panel over the blank page, so the bot's
 * browser itself loads nothing, and what is picked goes the address bar's own way. */
export function BrowserStartPage({ onOpen }: { onOpen: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div data-browser-start className="absolute inset-0 z-[5] flex flex-col items-center overflow-y-auto bg-card px-6 pt-[18%]">
      <form
        className="flex h-10 w-full max-w-md items-center gap-2 rounded-full border border-hairline/60 bg-inset px-3.5 focus-within:border-ink/30"
        onSubmit={(event) => { event.preventDefault(); if (text.trim()) onOpen(text); }}
      >
        <Search size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search or enter address"
          aria-label="Search or enter address"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
      </form>
      <ul className="mt-6 grid w-full max-w-md grid-cols-2 gap-1 sm:grid-cols-4">
        {START_SITES.map((site) => (
          <li key={site.address}>
            <button
              type="button"
              onClick={() => onOpen(site.address)}
              title={site.address}
              className="flex w-full flex-col items-center gap-2 rounded-xl px-2 py-3 text-center hover:bg-ink/[0.06]"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-inset">
                <ServiceIcon card={{ slug: site.slug, logo: null, domain: null, label: site.name }} className="size-6" />
              </span>
              <span className="w-full truncate text-[13px] text-ink">{site.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
