"use client";

import { useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { viewEntry, type ViewEntry } from "@/lib/plugins/catalog";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { HOME, activateTab, closeViews, openView, type ViewTab } from "@/lib/state/tabs";
import { Close, Plus } from "@/components/ui/icons";
import { SearchPanel } from "@/components/ui/search-panel";
import { NotificationCenter } from "./notification-center";

/* ---------------------------------------------------------------------------
   The tab bar, like a browser's: "Conversations" first, always there and
   never closed; then one tab per open view, each with its cross; "+" lists
   the views of the plugins that run; the bell on the right. Too many tabs
   for the width: the strip scrolls sideways.
--------------------------------------------------------------------------- */

type Props = { settings: Settings; views: ViewEntry[]; tabs: ViewTab[]; active: string };

export function TabBar({ settings, views, tabs, active }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="tb">
      <div className="tb-tabs" role="tablist" aria-label="Open pages">
        <button type="button" role="tab" aria-selected={active === HOME} className={`tb-tab tb-home${active === HOME ? " is-on" : ""}`} onClick={() => activateTab(HOME)}>
          Conversations
        </button>
        {tabs.map((t) => {
          const entry = viewEntry(t.view);
          if (!entry) return null;
          const on = active === t.view;
          return (
            <div key={t.view} className={`tb-tab${on ? " is-on" : ""}`}>
              <button type="button" role="tab" aria-selected={on} className="tb-label" onClick={() => activateTab(t.view)} title={entry.description}>
                {entry.title}
              </button>
              <button type="button" className="tb-close" onClick={() => closeViews([t.view])} aria-label={`Close ${entry.title}`}>
                <Close />
              </button>
            </div>
          );
        })}
      </div>
      <div className="picker tb-add">
        <button type="button" className={`tb-icon${adding ? " is-on" : ""}`} onClick={() => setAdding(!adding)} aria-haspopup="dialog" aria-expanded={adding} aria-label="Open a view" title="Open a view">
          <Plus />
        </button>
        <SearchPanel open={adding} onClose={() => setAdding(false)} label="Views" width={300} dense>
          {views.length === 0 ? (
            <SearchPanel.Empty>No view yet: switch on a plugin that has one, in Settings → Plugins.</SearchPanel.Empty>
          ) : (
            views.map((v) => (
              <SearchPanel.Item
                key={v.id}
                title={v.title}
                meta={v.plugin.name}
                selected={active === v.id}
                onSelect={() => {
                  openView(v.id);
                  setAdding(false);
                }}
              />
            ))
          )}
        </SearchPanel>
      </div>
      <span className="tb-space" />
      <NotificationCenter settings={settings} onOpenConversation={(id) => void ensureConversation(id, settings).then(() => goToConversation(id))} />
    </div>
  );
}
