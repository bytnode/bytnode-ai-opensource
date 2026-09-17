"use client";

import type { Theme } from "@/lib/domain/types";
import { Moon, Sun } from "./icons";

type Props = {
  theme: Theme;
  onChange: (theme: Theme) => void;
};

/* L'interrupteur ne fait que demander le changement : c'est la page qui pose
   `data-theme` sur <html> (voir `applyTheme`), d'ou le fond et la feuille de
   style le lisent. Un seul endroit ecrit, quel que soit le nombre de boutons. */
export function ThemeToggle({ theme, onChange }: Props) {
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label={next === "light" ? "Passer en clair" : "Passer en sombre"}
      title={next === "light" ? "Passer en clair" : "Passer en sombre"}
    >
      {theme === "light" ? <Moon /> : <Sun />}
    </button>
  );
}

export function applyTheme(theme: Theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}
