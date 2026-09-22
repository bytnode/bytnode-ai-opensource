"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, Search } from "./icons";
import "./ui.css";

/* ---------------------------------------------------------------------------
   The search panel: a bar on top, a list underneath.

   It serves twice — choosing a vendor, choosing a model — and knows nothing
   about what it lists: the parent gives it the query, updates it, and
   renders the rows with `SearchPanel.Item`. The panel only handles what is
   common: sitting under its trigger, focusing the bar on opening, closing on
   Escape or a click outside, and moving the arrows through the list.
--------------------------------------------------------------------------- */

type Props = {
  open: boolean;
  onClose: () => void;
  query?: string;
  onQuery?: (q: string) => void;
  /** Without `placeholder`, no search bar: a short list does not need
      one. */
  placeholder?: string;
  /** A header with a back button, for a view opened from another one. */
  title?: string;
  onBack?: () => void;
  /** Where the panel anchors: under the trigger (default) or above it. */
  side?: "bottom" | "top";
  align?: "start" | "end";
  width?: number | string;
  /** Tight rows, for a short list of simple choices. */
  dense?: boolean;
  label: string;
  children: ReactNode;
};

export function SearchPanel({
  open,
  onClose,
  query = "",
  onQuery,
  placeholder,
  title,
  onBack,
  side = "bottom",
  align = "start",
  width = 360,
  dense = false,
  label,
  children,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    (input.current ?? root.current?.querySelector<HTMLElement>("[data-item]"))?.focus();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  /* The arrows move focus between the bar and the rows; Enter on a row is
     the button's native click. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-item]") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const i = items.findIndex((el) => el === active);
    if (e.key === "ArrowDown") {
      (i < 0 ? items[0] : items[Math.min(i + 1, items.length - 1)]).focus();
    } else if (i <= 0) {
      (input.current ?? items[0]).focus();
    } else {
      items[i - 1].focus();
    }
  };

  return (
    <div
      ref={root}
      className={`sp sp-${side} sp-${align}${dense ? " is-dense" : ""}`}
      style={{ width }}
      role="dialog"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {onBack && (
        <div className="sp-head">
          <button type="button" className="sp-back" onClick={onBack} aria-label="Back">
            <ArrowLeft />
          </button>
          <span className="sp-head-title">{title}</span>
        </div>
      )}
      {placeholder && (
        <div className="sp-search">
          <Search />
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={placeholder}
            onChange={(e) => onQuery?.(e.target.value)}
            aria-label={placeholder}
          />
        </div>
      )}
      <div className="sp-list" role="listbox">
        {children}
      </div>
    </div>
  );
}

type ItemProps = {
  selected?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  /** A second line, in mono: the id, a size. */
  meta?: string;
  trailing?: ReactNode;
};

SearchPanel.Item = function Item({ selected, disabled, onSelect, title, meta, trailing }: ItemProps) {
  return (
    <button
      type="button"
      className={`sp-item${selected ? " is-selected" : ""}`}
      role="option"
      aria-selected={selected}
      data-item
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="sp-item-text">
        <span className="sp-item-title">{title}</span>
        {meta && <span className="sp-item-meta mono">{meta}</span>}
      </span>
      {trailing}
    </button>
  );
};

/* A row that is not a choice but an action to take first: the text on the
   left, a button on the right (sign in, install). */
SearchPanel.Row = function Row({ title, meta, action }: { title: string; meta?: string; action: ReactNode }) {
  return (
    <div className="sp-item sp-row" role="presentation">
      <span className="sp-item-text">
        <span className="sp-item-title">{title}</span>
        {meta && <span className="sp-item-meta mono">{meta}</span>}
      </span>
      {action}
    </div>
  );
};

SearchPanel.Empty = function Empty({ children }: { children: ReactNode }) {
  return <p className="sp-empty">{children}</p>;
};

SearchPanel.Group = function Group({ children }: { children: ReactNode }) {
  return <p className="sp-group">{children}</p>;
};
