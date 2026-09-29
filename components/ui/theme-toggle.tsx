"use client";

import type { Theme } from "@/lib/domain/types";

/* The theme is chosen in Settings → General only (no toggle elsewhere, the
   user's choice): the page sets `data-theme` on <html>, where the backdrop
   and the stylesheet read it from. A single writer. */
export function applyTheme(theme: Theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}
