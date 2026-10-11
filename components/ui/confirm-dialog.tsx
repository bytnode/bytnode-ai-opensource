"use client";

import { useEffect, useRef } from "react";
import { useMessages } from "@/lib/i18n/react";
import "./ui.css";

type Props = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/* ---------------------------------------------------------------------------
   A confirmation: a veil, two buttons.

   The destructive button is in solid ink — it is the action we came to do —
   and "Cancel" stays bare. Escape cancels; focus lands on Cancel so a stray
   Enter deletes nothing.
--------------------------------------------------------------------------- */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  const m = useMessages();
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="cd" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="cd-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" aria-describedby="cd-body">
        <h2 id="cd-title" className="cd-title">
          {title}
        </h2>
        <p id="cd-body" className="cd-body">
          {body}
        </p>
        <div className="cd-actions">
          <button ref={cancel} type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel ?? m.common.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
