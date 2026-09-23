"use client";

import "./ui.css";

/* ---------------------------------------------------------------------------
   A segmented control, like Apple's: a few mutually exclusive choices in
   one rounded track. `value` null: no segment is on (the view shows
   something none of them names — a day picked by hand, say).
--------------------------------------------------------------------------- */
export function Segmented<T extends string>({ value, options, onChange, label, wide = false }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string; wide?: boolean }) {
  return (
    <div className={`seg${wide ? " is-wide" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "is-on" : undefined} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
