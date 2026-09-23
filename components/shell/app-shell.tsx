"use client";

import type { Settings } from "@/lib/domain/types";
import { enabledViews, viewEntry } from "@/lib/plugins/catalog";
import { HOME, useTabs } from "@/lib/state/tabs";
import { ChatShell } from "@/components/chat/chat-shell";
import { ViewFrame } from "@/components/plugins/view-frame";
import { VIEWS } from "@/components/plugins/views";
import { ViewActive } from "@/components/plugins/view-activity";
import { TabBar } from "./tab-bar";
import { usePluginSession } from "./use-plugin-session";
import "./shell.css";

/* ---------------------------------------------------------------------------
   The app once set up: the tab bar on top, the open pages underneath.

   ⚠️ NOTHING UNMOUNTS WHEN THE TAB CHANGES. Every open page stays mounted,
   the ones behind simply hidden (they keep their layout, so their scroll
   too): a reply being written keeps streaming, a permission keeps
   waiting, and a plugin's view is found as it was left instead of loading
   again. A view behind is asleep (`ViewActive`, `view-activity.tsx`): its
   timers stop, and it catches up once when it comes back to the front.
   Closing a tab unmounts its view.
--------------------------------------------------------------------------- */
export function AppShell({ settings }: { settings: Settings }) {
  usePluginSession(settings);
  const tabs = useTabs();
  /* The views of the plugins that run and that the interface knows how to
     draw; a tab whose plugin is off is not shown. */
  const views = enabledViews(settings).filter((v) => VIEWS[v.id]);
  const visible = tabs.open.filter((t) => views.some((v) => v.id === t.view));
  const active = visible.some((t) => t.view === tabs.active) ? tabs.active : HOME;

  return (
    <div className="shell">
      <TabBar settings={settings} views={views} tabs={visible} active={active} />
      <div className="shell-body">
        <div className="shell-pane" hidden={active !== HOME}>
          <ChatShell settings={settings} />
        </div>
        {visible.map((tab) => {
          const entry = viewEntry(tab.view);
          if (!entry) return null;
          const front = tab.view === active;
          return (
            <div key={tab.view} className="shell-pane" hidden={!front}>
              <ViewActive value={front}>
                <ViewFrame entry={entry} tab={tab} settings={settings} />
              </ViewActive>
            </div>
          );
        })}
      </div>
    </div>
  );
}
