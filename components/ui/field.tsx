import type { ReactNode } from "react";

type Props = {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  /** Un lien sous le champ, toujours visible, meme en erreur (ou obtenir
      la cle, par exemple). */
  link?: { href: string; label: string };
  children: ReactNode;
};

/* L'enveloppe d'un champ : etiquette, controle, puis une aide ou une erreur.
   Le controle lui-meme est passe en enfant pour que la meme enveloppe serve a
   un `input`, un `textarea` ou un bouton qui ouvre un panneau. */
export function Field({ id, label, optional, hint, error, link, children }: Props) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {optional && <small>facultatif</small>}
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
