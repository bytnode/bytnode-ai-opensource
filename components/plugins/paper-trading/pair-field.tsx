"use client";

import { useId, useState } from "react";
import type { Listed } from "@/lib/plugins/shared/prices";
import { Search } from "@/components/ui/icons";
import { CASH } from "./format";

/* ---------------------------------------------------------------------------
   The ticket's pair: a search among every pair BytNode covers in USDT (the
   plugin's `pairs` action). A click opens the whole list under the field;
   typing narrows it — by ticker first, then by name. A click, or Enter on
   the lit one (↑ ↓ to move, Escape to close), chooses it. A pair BytNode
   does not list can still be typed: it is offered last, and priced from an
   exchange account when one lists it. The field shows the chosen pair
   whenever it is not being searched.
--------------------------------------------------------------------------- */

type Option = { symbol: string; base: string; name?: string; typed?: boolean };

/** What is typed, as a ticker: `eth`, `ETH/USDT`, `ethusdt` → `ETH`. */
const baseOfQuery = (q: string): string => {
  const t = q.trim().toUpperCase().replace(/[\s-]/g, "").split("/")[0];
  return t.length > 4 && t.endsWith(CASH) ? t.slice(0, -CASH.length) : t;
};

export function matchPairs(query: string, pairs: Listed[]): Option[] {
  const q = query.trim().toLowerCase();
  if (!q) return pairs;
  const base = baseOfQuery(query).toLowerCase();
  const rank = (p: Listed) => (p.base.toLowerCase() === base ? 0 : p.base.toLowerCase().startsWith(base) ? 1 : p.name?.toLowerCase().startsWith(q) ? 2 : p.name?.toLowerCase().includes(q) ? 3 : 9);
  return pairs
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
}

type Props = {
  value: string;
  pairs: Listed[] | null;
  /** Why BytNode's list is missing (no key). */
  unavailable: string | null;
  onChange: (symbol: string) => void;
};

export function PairField({ value, pairs, unavailable, onChange }: Props) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useId();

  const searching = query !== null;
  const matched = matchPairs(query ?? "", pairs ?? []);
  const typed = baseOfQuery(query ?? "");
  const offerTyped = searching && /^[A-Z0-9]{2,15}$/.test(typed) && !matched.some((o) => o.base === typed);
  const options: Option[] = offerTyped ? [...matched, { symbol: `${typed}/${CASH}`, base: typed, typed: true }] : matched;
  const shown = searching && options.length > 0;
  const lit = Math.min(active, options.length - 1);
  const known = pairs?.find((p) => p.symbol === value);

  const choose = (o: Option) => {
    onChange(o.symbol);
    setQuery(null);
    setActive(0);
  };

  return (
    <div className="ptv-pair">
      <div className="wlv-add-row">
        <Search />
        <input
          className="wlv-input"
          role="combobox"
          aria-label="Pair"
          aria-expanded={shown}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${list}-${lit}` : undefined}
          value={searching ? query : value}
          placeholder={`Search ${pairs?.length ?? ""} pairs — btc, Solana…`}
          autoComplete="off"
          spellCheck={false}
          onFocus={(e) => {
            setQuery("");
            setActive(Math.max(0, (pairs ?? []).findIndex((p) => p.symbol === value)));
            e.currentTarget.select();
          }}
          onBlur={() => setQuery(null)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (options.length) setActive((lit + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (shown) choose(options[lit]);
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {!searching && known?.name && <span className="ptv-pair-name">{known.name}</span>}
      </div>
      {unavailable && <p className="wlv-add-note">{unavailable}</p>}
      {shown && (
        <ul className="wlv-suggest ptv-suggest" id={list} role="listbox" aria-label="Pairs">
          {options.map((o, i) => (
            <li
              key={o.symbol}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === lit}
              className={`wlv-suggest-item${i === lit ? " is-lit" : ""}`}
              /* The field keeps the focus: a blur would close the list
                 before the click lands. */
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <b>{o.base}</b>
              <span className="wlv-suggest-name">{o.typed ? "Not listed by BytNode — priced from an exchange account" : (o.name ?? o.symbol)}</span>
              {o.symbol === value && <small className="wlv-suggest-src">Chosen</small>}
              <span className="wlv-suggest-pair">{CASH}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
