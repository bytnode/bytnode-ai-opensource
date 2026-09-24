"use client";

import { useId, useState } from "react";
import { WATCHLIST } from "@/lib/plugins/alerts/alerts";
import type { Listed } from "@/lib/plugins/shared/prices";
import { Search } from "@/components/ui/icons";

/* ---------------------------------------------------------------------------
   The asset of an alert: a search among BytNode's pairs, with "Every asset
   of my watchlist" first. A click opens the list, typing narrows it — by
   ticker first, then by name; ↑ ↓ and Enter choose, Escape closes. A pair
   BytNode does not list can still be typed (`ABC` → ABC/USDT): an
   exchange account may price it. The field shows the choice whenever it is
   not being searched.
--------------------------------------------------------------------------- */

type Option = { symbol: string; base: string; name?: string };

const MAX = 60;

const baseOfQuery = (q: string) => {
  const t = q.trim().toUpperCase().replace(/[\s-]/g, "").split("/")[0];
  return t.length > 4 && t.endsWith("USDT") ? t.slice(0, -4) : t;
};

function match(query: string, pairs: Listed[]): Option[] {
  const q = query.trim().toLowerCase();
  if (!q) return pairs.slice(0, MAX);
  const base = baseOfQuery(query).toLowerCase();
  const rank = (p: Listed) => (p.base.toLowerCase() === base ? 0 : p.base.toLowerCase().startsWith(base) ? 1 : p.name?.toLowerCase().startsWith(q) ? 2 : p.name?.toLowerCase().includes(q) ? 3 : 9);
  return pairs
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r)
    .slice(0, MAX)
    .map((x) => x.p);
}

type Props = { value: string; pairs: Listed[] | null; onChange: (target: string) => void };

export function PairField({ value, pairs, onChange }: Props) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useId();

  const searching = query !== null;
  const typed = baseOfQuery(query ?? "");
  const matched = match(query ?? "", pairs ?? []);
  const offerTyped = searching && /^[A-Z0-9]{2,15}$/.test(typed) && !matched.some((o) => o.base === typed);
  const watchlistFirst = !query?.trim() || "watchlist".startsWith(query.trim().toLowerCase());
  const options: Option[] = [...(watchlistFirst ? [{ symbol: WATCHLIST, base: "Watchlist", name: "Every asset of my watchlist" }] : []), ...matched, ...(offerTyped ? [{ symbol: `${typed}/USDT`, base: typed, name: "Not listed by BytNode — priced from an exchange account" }] : [])];
  const lit = Math.min(active, options.length - 1);
  const shownValue = value === WATCHLIST ? "Every asset of my watchlist" : value;

  const choose = (o: Option) => {
    onChange(o.symbol);
    setQuery(null);
    setActive(0);
  };

  return (
    <div className="alv-pair">
      <Search />
      <input
        className="alv-input"
        role="combobox"
        aria-expanded={searching}
        aria-controls={list}
        aria-label="Asset"
        placeholder={pairs ? "Search a pair — BTC, ether…" : "BTC/USDT"}
        value={searching ? query : shownValue}
        onFocus={() => setQuery("")}
        onBlur={() => setQuery(null)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive(Math.min(lit + 1, options.length - 1));
          else if (e.key === "ArrowUp") setActive(Math.max(lit - 1, 0));
          else if (e.key === "Escape") {
            /* Closes the list, not the window it sits in. */
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
          }
          else if (e.key === "Enter" && options[lit]) {
            e.preventDefault();
            choose(options[lit]);
            (e.target as HTMLInputElement).blur();
          } else return;
          e.preventDefault();
        }}
      />
      {searching && options.length > 0 && (
        <ul className="alv-suggest" id={list} role="listbox" aria-label="Pairs">
          {options.map((o, i) => (
            <li key={o.symbol}>
              <button
                type="button"
                role="option"
                aria-selected={i === lit}
                className={`alv-suggest-item${i === lit ? " is-lit" : ""}`}
                /* Chosen before the field's blur closes the list. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <b>{o.base}</b>
                <span>{o.name ?? o.symbol}</span>
                {o.symbol === value && <small>Chosen</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
