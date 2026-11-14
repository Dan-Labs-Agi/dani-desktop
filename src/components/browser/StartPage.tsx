import { useState } from "react";
import { Search } from "@/components/icons";

/** The sites a blank tab offers. Each opens by its address, as if typed in the address bar. */
export const START_SITES: readonly { name: string; address: string }[] = [
  { name: "Google", address: "google.com" },
  { name: "YouTube", address: "youtube.com" },
  { name: "Gmail", address: "mail.google.com" },
  { name: "GitHub", address: "github.com" },
  { name: "Wikipedia", address: "wikipedia.org" },
  { name: "Reddit", address: "reddit.com" },
  { name: "X", address: "x.com" },
  { name: "LinkedIn", address: "linkedin.com" },
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
              className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-ink/[0.06]"
            >
              <span className="text-[13px] text-ink">{site.name}</span>
              <span className="w-full truncate text-[12px] text-ink-tertiary">{site.address}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
