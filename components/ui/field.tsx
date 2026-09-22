import type { ReactNode } from "react";

type Props = {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  /** A link under the field, always visible, even in error state (where to
      get the key, for example). */
  link?: { href: string; label: string };
  children: ReactNode;
};

/* The wrapper of a field: label, control, then a hint or an error.
   The control itself is passed as a child so the same wrapper serves an
   `input`, a `textarea` or a button that opens a panel. */
export function Field({ id, label, optional, hint, error, link, children }: Props) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <small>optional</small>}
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
        <p className="field-link">
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.label} ↗
          </a>
        </p>
      )}
    </div>
  );
}
