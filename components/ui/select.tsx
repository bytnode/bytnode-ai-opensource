"use client";

import { useState } from "react";
import { ChevronDown } from "./icons";
import { SearchPanel } from "./search-panel";

/* ---------------------------------------------------------------------------
   Un choix parmi quelques valeurs, a la place d'un `<select>` natif.

   La liste native est dessinee par le systeme, hors de notre palette et de
   notre typographie — sous Windows, une boite grise a fleches sur un fond
   bleu nuit. Ici : le declencheur d'un champ, et le panneau de recherche de
   l'application (sans barre de recherche : la liste est courte), avec ses
   fleches, son Echap et son clic a cote. Memes briques que le choix du
   fournisseur ou du modele, donc meme allure partout.
--------------------------------------------------------------------------- */

export type SelectOption = { value: string; label: string; meta?: string };

type Props = {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Le nom de la liste, pour les lecteurs d'ecran. */
  label: string;
  placeholder?: string;
};

export function Select({ id, value, options, onChange, label, placeholder = "Choisir" }: Props) {
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
