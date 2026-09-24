"use client";

import { useState } from "react";
import { Plus } from "@/components/ui/icons";
import { CASH, pct, toneOf, usdt, type BookRow } from "./format";

/* ---------------------------------------------------------------------------
   The left column: the paper portfolios, like the watchlist's assets —
   each its name, under it its value and what is open in it, and its
   result in a pill of Apple's green or red; the one shown is lit. The
   first is the default one (what an agent trades when it names none), and
   says so. Under the list,
   "New portfolio" opens a small form in place: a name, a starting capital.
--------------------------------------------------------------------------- */

type Props = {
  books: BookRow[] | null;
  selected: string | null;
  defaultCapital: number;
  onPick: (id: string) => void;
  /** Creates a portfolio; answers why not, or null. */
  onCreate: (name: string, capital: number) => Promise<string | null>;
};

export function Books({ books, selected, defaultCapital, onPick, onCreate }: Props) {
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
            <li key={b.id}>
              <button type="button" className={`wlv-row ptv-book${on ? " is-selected" : ""}`} aria-current={on || undefined} onClick={() => onPick(b.id)}>
                <span className="wlv-row-name">
                  <b>{b.name}</b>
                  <small>
                    <span className="ptv-book-value">{usdt(b.equity)}</span>
                    {[i === 0 && books.length > 1 ? "default" : "", open].filter(Boolean).map((t) => ` · ${t}`).join("")}
                  </small>
                </span>
                <span className={`wlv-pill ${toneOf(b.returnPct)}`}>{pct(b.returnPct)}</span>
              </button>
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
