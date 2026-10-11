"use client";

import { useId, useState } from "react";
import { suggest, type Candidate } from "@/lib/plugins/watchlist/suggest";
import { Search } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";

/* The field that adds an asset, as a search among BytNode's assets only:
   from the first letter, a list opens under it — ticker, name, quote —
   and what BytNode does not cover is "not found", never offered. A
   click, or Enter on the lit one (the first by default; ↑ ↓ to move,
   Escape to close), adds it and shows it. An asset already followed says
   so, and choosing it just shows it. Without BytNode's list (no key), the
   field says why it cannot add. */

type Option = Candidate & { followed: boolean };

type Props = {
  catalog: Candidate[];
  /** Why nothing can be added (no BytNode key); the field is off. */
  unavailable: string | null;
  followed: ReadonlySet<string>;
  onAdd: (symbol: string) => Promise<boolean>;
  onPick: (symbol: string) => void;
};

export function AddField({ catalog, unavailable, followed, onAdd, onPick }: Props) {
  const m = useMessages();
  const t = m.watchlist.add;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const list = useId();

  const options: Option[] = suggest(query, catalog).map((c) => ({ ...c, followed: followed.has(c.symbol) }));
  const shown = open && options.length > 0;
  const notFound = open && query.trim() !== "" && options.length === 0;
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
          aria-label={t.label}
          aria-expanded={shown}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${list}-${lit}` : undefined}
          placeholder={unavailable ? t.label : t.placeholder}
          value={query}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || unavailable !== null}
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
      {unavailable && <p className="wlv-add-note">{unavailable}</p>}
      {notFound && (
        <p className="wlv-suggest wlv-suggest-none" role="status">
          {t.notFound(query.trim())}
        </p>
      )}
      {shown && (
        <ul className="wlv-suggest" id={list} role="listbox" aria-label={t.options}>
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
              <span className="wlv-suggest-name">{o.name ?? o.symbol}</span>
              {o.followed && <small className="wlv-suggest-src">{t.inList}</small>}
              <span className="wlv-suggest-pair">{o.symbol.split("/")[1]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
