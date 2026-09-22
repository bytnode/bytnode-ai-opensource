"use client";

import { useState } from "react";
import { ChevronDown } from "./icons";
import { SearchPanel } from "./search-panel";

/* ---------------------------------------------------------------------------
   A choice among a few values, in place of a native `<select>`.

   The native list is drawn by the system, outside our palette and our
   typography — on Windows, a grey box with arrows on a midnight-blue
   background. Here: a field's trigger, and the application's search panel
   (without a search bar: the list is short), with its arrows, its Escape and
   its click-outside. Same bricks as the provider or model choice, hence the
   same look everywhere.
--------------------------------------------------------------------------- */

export type SelectOption = { value: string; label: string; meta?: string };

type Props = {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** The list's name, for screen readers. */
  label: string;
  placeholder?: string;
};

export function Select({ id, value, options, onChange, label, placeholder = "Choose" }: Props) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="picker">
      <button id={id} type="button" className={`picker-trigger as-field${current ? "" : " is-empty"}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current?.label ?? placeholder}</span>
        <ChevronDown />
      </button>
      <SearchPanel open={open} onClose={() => setOpen(false)} label={label} width="100%" dense>
        {options.map((o) => (
          <SearchPanel.Item
            key={o.value}
            title={o.label}
            meta={o.meta}
            selected={o.value === value}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
            }}
          />
        ))}
      </SearchPanel>
    </div>
  );
}
