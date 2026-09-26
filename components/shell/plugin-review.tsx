"use client";

import { useEffect } from "react";
import type { Settings } from "@/lib/domain/types";
import { closeReview, useReviewing } from "@/lib/state/user-plugins";
import { PluginConsent } from "@/components/plugins/plugin-consent";
import "@/components/ui/ui.css";

/* ---------------------------------------------------------------------------
   The review of a plugin written by an agent, opened from the library (or
   an older notification): the same consent block as in the conversation
   (`components/plugins/plugin-consent.tsx`), in a window.
--------------------------------------------------------------------------- */

export function PluginReview({ settings }: { settings: Settings }) {
  const id = useReviewing();
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeReview();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [id]);
  if (!id) return null;
  return (
    <div className="cd" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeReview()}>
      <div className="cd-sheet prv" role="dialog" aria-modal="true" aria-label="Review the plugin">
        <PluginConsent pluginId={id} settings={settings} />
        <div className="cd-actions">
          <button type="button" className="btn btn-ghost" onClick={closeReview}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
