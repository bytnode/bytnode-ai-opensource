"use client";

import { useState } from "react";
import type { Settings } from "@/lib/domain/types";
import type { ViewEntry } from "@/lib/plugins/catalog";
import type { ViewTab } from "@/lib/state/tabs";
import { Refresh } from "@/components/ui/icons";
import { VIEWS } from "./views";
import "./plugins.css";

/* ---------------------------------------------------------------------------
   A plugin's tab: its title, a refresh button, and the view itself. The
   refresh remounts the view — it reloads its data from the start, like
   opening the tab again.
--------------------------------------------------------------------------- */
export function ViewFrame({ entry, tab, settings }: { entry: ViewEntry; tab: ViewTab; settings: Settings }) {
  const [round, setRound] = useState(0);
  const View = VIEWS[entry.id];
  return (
    <section className="pv" aria-labelledby={`pv-${entry.id}`}>
      <header className="pv-head">
        <div className="pv-titles">
          <h1 id={`pv-${entry.id}`} className="pv-title">
            {entry.title}
          </h1>
          <p className="pv-lede">{entry.description}</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRound(round + 1)} title="Reload the data">
          <Refresh />
          Refresh
        </button>
      </header>
      <div className="pv-body">{View ? <View key={round} settings={settings} params={tab.params} /> : <p className="pv-empty">This view is not available.</p>}</div>
    </section>
  );
}
