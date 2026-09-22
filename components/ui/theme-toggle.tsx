"use client";

import type { Theme } from "@/lib/domain/types";
import { Moon, Sun } from "./icons";

type Props = {
  theme: Theme;
  onChange: (theme: Theme) => void;
};

/* The toggle only requests the change: the page is what sets `data-theme`
   on <html> (see `applyTheme`), where the backdrop and the stylesheet read it
   from. A single writer, however many buttons there are. */
export function ThemeToggle({ theme, onChange }: Props) {
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label={next === "light" ? "Switch to light" : "Switch to dark"}
      title={next === "light" ? "Switch to light" : "Switch to dark"}
    >
      {theme === "light" ? <Moon /> : <Sun />}
    </button>
  );
}

export function applyTheme(theme: Theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}
