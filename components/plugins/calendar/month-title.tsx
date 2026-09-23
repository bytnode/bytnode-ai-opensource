"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { useDismiss } from "@/components/ui/use-dismiss";
import { LOCALE } from "./format";

/* The month and the year of the title, each a button: the month opens the
   twelve months, the year twelve years at a time. */

const YEARS = 12;

export function MonthTitle({ month, today, onChange }: { month: Date; today: Date; onChange: (month: Date) => void }) {
  const [open, setOpen] = useState<"month" | "year" | null>(null);
  const [first, setFirst] = useState(month.getFullYear() - 5);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(open !== null, close, root);
  const year = month.getFullYear();
  const pick = (d: Date) => {
    onChange(d);
    setOpen(null);
  };

  return (
    <div className="calv-anchor" ref={root}>
      <h1 className="calv-title">
        <button type="button" className={`calv-title-btn${open === "month" ? " is-open" : ""}`} aria-expanded={open === "month"} aria-label="Choose the month" onClick={() => setOpen(open === "month" ? null : "month")}>
          {month.toLocaleDateString(LOCALE, { month: "long" })}
        </button>{" "}
        <button
          type="button"
          className={`calv-title-btn is-year${open === "year" ? " is-open" : ""}`}
          aria-expanded={open === "year"}
          aria-label="Choose the year"
          onClick={() => {
            setFirst(year - 5);
            setOpen(open === "year" ? null : "year");
          }}
        >
          {year}
        </button>
      </h1>
      {open === "month" && (
        <div className="calv-pop calv-picker" role="dialog" aria-label="Months">
          <div className="calv-picker-grid">
            {Array.from({ length: 12 }, (_, i) => new Date(year, i, 1)).map((d) => (
              <button
                key={d.getMonth()}
                type="button"
                className={`calv-picker-item${d.getMonth() === month.getMonth() ? " is-current" : ""}${d.getMonth() === today.getMonth() && year === today.getFullYear() ? " is-today" : ""}`}
                onClick={() => pick(d)}
              >
                {d.toLocaleDateString(LOCALE, { month: "short" })}
              </button>
            ))}
          </div>
        </div>
      )}
      {open === "year" && (
        <div className="calv-pop calv-picker" role="dialog" aria-label="Years">
          <div className="calv-picker-head">
            <button type="button" className="calv-icon is-small" onClick={() => setFirst(first - YEARS)} aria-label="Earlier years">
              <ChevronLeft />
            </button>
            <span>
              {first} – {first + YEARS - 1}
            </span>
            <button type="button" className="calv-icon is-small" onClick={() => setFirst(first + YEARS)} aria-label="Later years">
              <ChevronRight />
            </button>
          </div>
          <div className="calv-picker-grid">
            {Array.from({ length: YEARS }, (_, i) => first + i).map((y) => (
              <button key={y} type="button" className={`calv-picker-item${y === year ? " is-current" : ""}${y === today.getFullYear() ? " is-today" : ""}`} onClick={() => pick(new Date(y, month.getMonth(), 1))}>
                {y}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
