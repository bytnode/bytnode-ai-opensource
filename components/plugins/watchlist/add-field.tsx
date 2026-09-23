"use client";

import { useId, useState } from "react";
import { baseOf, normalizeSymbol } from "@/lib/plugins/shared/quote";
import { suggest, type Candidate } from "@/lib/plugins/watchlist/suggest";
import { Search } from "@/components/ui/icons";
import { sourceName } from "./format";

/* The field that adds an asset, as a search: from the first letter, a
   list opens under it with the assets that can be followed — ticker, name,
   where the price will come from — and a pair typed that the list does
   not know, last. A click, or Enter on the lit one (the first by default;
   ↑ ↓ to move, Escape to close), adds it and shows it. An asset already
   followed says so, and choosing it just shows it. */

type Option = Candidate & { followed: boolean; free?: boolean };

type Props = {
  catalog: Candidate[];
  followed: ReadonlySet<string>;
  onAdd: (symbol: string) => Promise<boolean>;
  onPick: (symbol: string) => void;
};

export function AddField({ catalog, followed, onAdd, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const list = useId();

  const hits: Option[] = suggest(query, catalog).map((c) => ({ ...c, followed: followed.has(c.symbol) }));
  const typed = query.trim() ? normalizeSymbol(query) : null;
  const options: Option[] = typed && !hits.some((h) => h.symbol === typed) ? [...hits, { symbol: typed, base: baseOf(typed), sources: [], followed: followed.has(typed), free: true }] : hits;
  const shown = open && options.length > 0;
  const lit = Math.min(active, options.length - 1);

  const reset = () => {
    setQuery("");
    setOpen(false);
    setActive(0);
  };
  const choose = async (o: Option) => {
    if (busy) return;
    if (o.followed) {
      onPick(o.symbol);
      reset();
      return;
    }
    setBusy(true);
    const ok = await onAdd(o.symbol);
    setBusy(false);
    if (ok) {
      onPick(o.symbol);
      reset();
    }
  };

  return (
    <div className="wlv-add">
      <div className="wlv-add-row">
        <Search />
        <input
          className="wlv-input"
          role="combobox"
          aria-label="Add an asset"
          aria-expanded={shown}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${list}-${lit}` : undefined}
          placeholder="Add an asset — btc, Solana, ETH/USDC…"
          value={query}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              if (options.length) setActive((lit + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (shown) void choose(options[lit]);
            } else if (e.key === "Escape") {
              if (shown) e.preventDefault();
              setOpen(false);
            }
          }}
        />
      </div>
      {shown && (
        <ul className="wlv-suggest" id={list} role="listbox" aria-label="Assets to add">
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
              onClick={() => void choose(o)}
            >
              <b>{o.base}</b>
              <span className="wlv-suggest-name">{o.free ? `Add ${o.symbol}` : (o.name ?? o.symbol)}</span>
              <small className="wlv-suggest-src">{o.followed ? "In your list" : o.free ? "As typed" : o.sources.length ? o.sources.map(sourceName).slice(0, 2).join(" · ") : "No price source yet"}</small>
              <span className="wlv-suggest-pair">{o.symbol.split("/")[1]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
