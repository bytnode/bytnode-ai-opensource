"use client";

import { useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { viewEntry, type ViewEntry } from "@/lib/plugins/catalog";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { HOME, activateTab, closeViews, openView, type ViewTab } from "@/lib/state/tabs";
import { useUiPrefs } from "@/lib/state/ui";
import { Close, Plus } from "@/components/ui/icons";
import { SearchPanel } from "@/components/ui/search-panel";
import { NotificationCenter } from "./notification-center";
import { TabIcon } from "./tab-icons";

/* ---------------------------------------------------------------------------
   The tab bar, like Edge's: "Conversations" first, always there and never
   closed; then one tab per open view — its icon, its title cut short, its
   cross; "+" right after the last tab lists the views of the plugins that
   run; the bell on the right. The tab in front is lighter, round at the
   top and flared at its foot into the page under it; the others lie flat
   on the bar, a thin rule between two of them. They keep a browser tab's
   width and narrow as more open; past their narrowest, the strip scrolls
   sideways. "Conversations" is the exception:
   it takes the width of the conversations' column under it (the user's,
   `lib/state/ui.ts`), so its edge falls on the column's, and it always
   reads a notch brighter than the other tabs.
--------------------------------------------------------------------------- */

type Props = { settings: Settings; views: ViewEntry[]; tabs: ViewTab[]; active: string };

export function TabBar({ settings, views, tabs, active }: Props) {
  const [adding, setAdding] = useState(false);
  const { sidebarWidth } = useUiPrefs();
  return (
    <div className="tb" style={{ "--tb-home": `${sidebarWidth}px` } as React.CSSProperties}>
      <div className="tb-tabs" role="tablist" aria-label="Open pages">
        {/* Built like the others (a tab around its label); its width is
            the column's, not a share of the bar. */}
        <div className={`tb-tab tb-tab-home${active === HOME ? " is-on" : ""}`}>
          <button type="button" role="tab" aria-selected={active === HOME} className="tb-home" onClick={() => activateTab(HOME)}>
            <TabIcon view="home" className="tb-favicon" />
            <span className="tb-title">Conversations</span>
          </button>
        </div>
        {tabs.map((t) => {
          const entry = viewEntry(t.view);
          if (!entry) return null;
          const on = active === t.view;
          return (
            <div key={t.view} className={`tb-tab${on ? " is-on" : ""}`}>
              <span className="tb-sep" aria-hidden />
              <button type="button" role="tab" aria-selected={on} className="tb-label" onClick={() => activateTab(t.view)} title={entry.description}>
                <TabIcon view={t.view} className="tb-favicon" />
                <span className="tb-title">{entry.title}</span>
              </button>
              <button type="button" className="tb-close" onClick={() => closeViews([t.view])} aria-label={`Close ${entry.title}`}>
                <Close />
              </button>
            </div>
          );
        })}
      </div>
      {/* Right after the last tab — outside the strip, whose scrolling
          would cut its list off. */}
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
