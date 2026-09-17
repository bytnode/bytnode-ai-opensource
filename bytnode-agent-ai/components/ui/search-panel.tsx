"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, Search } from "./icons";
import "./ui.css";

/* ---------------------------------------------------------------------------
   Le panneau de recherche : une barre en haut, une liste en dessous.

   Il sert deux fois — choisir un editeur, choisir un modele — et ne sait rien
   de ce qu'il liste : le parent lui donne la requete, la met a jour, et rend
   les lignes avec `SearchPanel.Item`. Le panneau ne s'occupe que de ce qui
   est commun : se placer sous son declencheur, donner le focus a la barre a
   l'ouverture, se fermer sur Echap ou un clic dehors, et faire circuler les
   fleches dans la liste.
--------------------------------------------------------------------------- */

type Props = {
  open: boolean;
  onClose: () => void;
  query?: string;
  onQuery?: (q: string) => void;
  /** Sans `placeholder`, pas de barre de recherche : une liste courte n'en a
      pas besoin. */
  placeholder?: string;
  /** Un en-tete avec retour, pour une vue ouverte depuis une autre. */
  title?: string;
  onBack?: () => void;
  /** Ou le panneau s'accroche : sous le declencheur (par defaut) ou au-dessus. */
  side?: "bottom" | "top";
  align?: "start" | "end";
  width?: number | string;
  /** Des lignes serrees, pour une liste courte de choix simples. */
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

  /* Les fleches font circuler le focus entre la barre et les lignes ; Entree
     sur une ligne est le clic natif du bouton. */
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
          <button type="button" className="sp-back" onClick={onBack} aria-label="Retour">
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
  /** Une seconde ligne, en mono : l'id, une taille. */
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

/* Une ligne qui n'est pas un choix mais une action a faire d'abord : le
   texte a gauche, un bouton a droite (se connecter, installer). */
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
