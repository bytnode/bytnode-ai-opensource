"use client";

import { useEffect, useRef } from "react";
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
   Une confirmation : un voile, deux boutons.

   Le bouton qui detruit est en encre pleine — c'est l'action qu'on est venu
   faire — et « Annuler » reste nu. Echap annule ; le focus est pose sur
   Annuler pour qu'un Entree distrait ne supprime rien.
--------------------------------------------------------------------------- */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = "Annuler", onConfirm, onCancel }: Props) {
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
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
