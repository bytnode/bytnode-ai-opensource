"use client";

import type { ReactNode } from "react";
import { useMessages } from "@/lib/i18n/react";

type Props = {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  /** A link under the field, always visible, even in error state (where to
      get the key, for example). `button`: drawn as a button — the next
      gesture, not a footnote (the OpenRouter key's page, 2026-10-09). */
  link?: { href: string; label: string; button?: boolean };
  children: ReactNode;
};

/* The wrapper of a field: label, control, then a hint or an error.
   The control itself is passed as a child so the same wrapper serves an
   `input`, a `textarea` or a button that opens a panel. */
export function Field({ id, label, optional, hint, error, link, children }: Props) {
  const m = useMessages();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <small>{m.common.optional}</small>}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
      {link && (
        <p className={`field-link${link.button ? " is-button" : ""}`}>
          <a href={link.href} target="_blank" rel="noreferrer" className={link.button ? "btn btn-sm" : undefined}>
            {link.label} ↗
          </a>
        </p>
      )}
    </div>
  );
}
