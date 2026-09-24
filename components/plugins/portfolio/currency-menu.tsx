"use client";

import { useRef, useState } from "react";
import { CURRENCIES } from "@/lib/plugins/shared/fx";
import { Check, ChevronDown } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/use-dismiss";

/* The currency the figures are in: a chip beside the tab's name that
   opens a short list — the calendar's bubble, a tick on the one in use. */

const NAMES: Record<string, string> = { USD: "US dollar", EUR: "Euro", GBP: "Pound sterling", JPY: "Japanese yen", AUD: "Australian dollar", CHF: "Swiss franc" };

export function CurrencyMenu({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  return (
    <div className="pfv-currency" ref={root}>
      <button type="button" className={`pfv-currency-chip${open ? " is-open" : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-label={`Currency: ${value}`} onClick={() => setOpen(!open)}>
        {value}
        <ChevronDown />
      </button>
      {open && (
        <ul className="pfv-currency-list" role="listbox" aria-label="Currency">
          {CURRENCIES.map((c) => (
            <li key={c}>
              <button
                type="button"
                role="option"
                aria-selected={c === value}
                className={c === value ? "is-on" : undefined}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                <b>{c}</b>
                <span>{NAMES[c] ?? ""}</span>
                {c === value && <Check />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
