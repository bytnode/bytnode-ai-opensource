"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "@/components/ui/icons";
import { fmt } from "../bits";
import { CASH, baseOf, pct, sameFocus, signed, toneOf, usdt, type BookRow, type Focus, type PaperState } from "./format";

/* ---------------------------------------------------------------------------
   The left column: the paper portfolios, like the watchlist's assets —
   each its name, under it its value and what is open in it, and its
   result in a pill of Apple's green or red; the one shown is lit. The
   first is the default one (what an agent trades when it names none), and
   says so. The chevron before a portfolio opens it in place: under it,
   each thing it holds — its futures positions, then its spot holdings —
   with its result; a click shows that one alone in the middle sheet.
   Only the portfolio shown can be opened (its figures are the ones read):
   opening another shows it first. Under the list, "New portfolio" opens
   a small form in place: a name, a starting capital.
--------------------------------------------------------------------------- */

type Props = {
  books: BookRow[] | null;
  selected: string | null;
  defaultCapital: number;
  onPick: (id: string) => void;
  /** The portfolios opened in place (their positions listed under them). */
  expanded: string[];
  onExpand: (id: string) => void;
  /** The portfolio shown, whose positions the opened row lists. */
  data: PaperState | null;
  focus: Focus | null;
  onFocus: (focus: Focus) => void;
  /** Creates a portfolio; answers why not, or null. */
  onCreate: (name: string, capital: number) => Promise<string | null>;
};

export function Books({ books, selected, defaultCapital, onPick, expanded, onExpand, data, focus, onFocus, onCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [capital, setCapital] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const amount = capital.trim() ? Number(capital.replace(/\s/g, "").replace(",", ".")) : defaultCapital;
    if (!Number.isFinite(amount)) return setProblem("The capital is a number of USDT.");
    setBusy(true);
    const p = await onCreate(name, amount);
    setBusy(false);
    setProblem(p);
    if (!p) {
      setCreating(false);
      setName("");
      setCapital("");
    }
  };

  return (
    <section className="wlv-pane wlv-side ptv-nav" aria-label="Paper portfolios">
      <header className="wlv-side-bar">
        <h2 className="wlv-title">
          <span className="pv-ink">Paper trading</span>
        </h2>
        {books && books.length > 1 && <span className="wlv-count">{books.length}</span>}
      </header>

      <ul className="wlv-rows ptv-books" aria-label="Portfolios">
        {books === null && <li className="ptv-books-loading">Reading your portfolios…</li>}
        {books?.map((b, i) => {
          const on = b.id === selected;
          const open = [b.positions ? `${b.positions} position${b.positions === 1 ? "" : "s"}` : "", b.orders ? `${b.orders} order${b.orders === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
          return (
            <li key={b.id} className={`ptv-book-item${expanded.includes(b.id) ? " is-open" : ""}`}>
              <button type="button" className="ptv-book-toggle" onClick={() => onExpand(b.id)} aria-expanded={expanded.includes(b.id)} aria-label={`${expanded.includes(b.id) ? "Hide" : "Show"} the positions of ${b.name}`} title={expanded.includes(b.id) ? "Hide the positions" : "Show the positions"}>
                <ChevronDown />
              </button>
              <button type="button" className={`wlv-row ptv-book${on && !focus ? " is-selected" : ""}${on && focus ? " is-parent" : ""}`} aria-current={(on && !focus) || undefined} onClick={() => onPick(b.id)}>
                <span className="wlv-row-name">
                  <b>{b.name}</b>
                  <small>
                    <span className="ptv-book-value">{usdt(b.equity)}</span>
                    {[i === 0 && books.length > 1 ? "default" : "", open].filter(Boolean).map((t) => ` · ${t}`).join("")}
                  </small>
                </span>
                <span className={`wlv-pill ${toneOf(b.returnPct)}`}>{pct(b.returnPct)}</span>
              </button>
              {expanded.includes(b.id) && on && <Items data={data && data.id === b.id ? data : null} focus={focus} onFocus={onFocus} />}
            </li>
          );
        })}
      </ul>

      <div className="ptv-new">
        {creating ? (
          <form
            className="ptv-new-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void create();
            }}
          >
            <input className="wlv-input" aria-label="Name of the new portfolio" placeholder="Name — “Swing BTC”" value={name} autoFocus maxLength={40} onChange={(e) => setName(e.target.value)} />
            <input className="wlv-input" aria-label="Starting capital in USDT" inputMode="decimal" placeholder={`Capital — ${usdt(defaultCapital)} ${CASH}`} value={capital} onChange={(e) => setCapital(e.target.value)} />
            {problem && <p className="ptv-new-problem">{problem}</p>}
            <div className="ptv-new-actions">
              <button
                type="button"
                className="ptv-pill"
                onClick={() => {
                  setCreating(false);
                  setProblem(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="ptv-pill is-primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="ptv-new-open" onClick={() => setCreating(true)}>
            <Plus />
            New portfolio
          </button>
        )}
      </div>
    </section>
  );
}

/** What an opened portfolio holds, one row each: the positions, then the
    spot holdings, each with its result; the one shown is lit. */
function Items({ data, focus, onFocus }: { data: PaperState | null; focus: Focus | null; onFocus: (focus: Focus) => void }) {
  if (!data) return <p className="ptv-items-note">Reading…</p>;
  const { positions, holdings } = data.valuation;
  if (positions.length === 0 && holdings.length === 0) return <p className="ptv-items-note">Nothing open.</p>;
  return (
    <ul className="ptv-items" aria-label={`What ${data.name} holds`}>
      {positions.map((p) => {
        const f: Focus = { kind: "position", symbol: p.symbol };
        const on = sameFocus(f, focus);
        const roe = p.unrealized !== undefined && p.margin > 0 ? (p.unrealized / p.margin) * 100 : undefined;
        return (
          <li key={`p:${p.symbol}`}>
            <button type="button" className={`ptv-item${on ? " is-selected" : ""}`} aria-current={on || undefined} onClick={() => onFocus(f)}>
              <span className="ptv-item-name">
                <b>{baseOf(p.symbol)}</b>
                <em className={p.side === "long" ? "is-up" : "is-down"}>{p.side === "long" ? "Long" : "Short"}</em>
                <small>×{p.leverage}</small>
              </span>
              <span className={`ptv-item-result ${toneOf(p.unrealized)}`}>
                {signed(p.unrealized)}
                <small>{pct(roe)}</small>
              </span>
            </button>
          </li>
        );
      })}
      {holdings.map((h) => {
        const f: Focus = { kind: "holding", asset: h.asset };
        const on = sameFocus(f, focus);
        return (
          <li key={`h:${h.asset}`}>
            <button type="button" className={`ptv-item${on ? " is-selected" : ""}`} aria-current={on || undefined} onClick={() => onFocus(f)}>
              <span className="ptv-item-name">
                <b>{h.asset}</b>
                <em>Spot</em>
                <small>{fmt(h.amount)}</small>
              </span>
              <span className={`ptv-item-result ${toneOf(h.unrealized)}`}>
                {signed(h.unrealized)}
                <small>{usdt(h.value)}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
