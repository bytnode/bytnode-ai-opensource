"use client";

import type { Settings } from "@/lib/domain/types";
import { enabledViews, viewEntry } from "@/lib/plugins/catalog";
import { HOME, useTabs } from "@/lib/state/tabs";
import { ChatShell } from "@/components/chat/chat-shell";
import { ViewFrame } from "@/components/plugins/view-frame";
import { VIEWS } from "@/components/plugins/views";
import { TabBar } from "./tab-bar";
import { usePluginSession } from "./use-plugin-session";
import "./shell.css";

/* ---------------------------------------------------------------------------
   The app once set up: the tab bar on top, the open page underneath.

   ⚠️ THE CONVERSATIONS STAY MOUNTED. Switching to a plugin's tab hides the
   chat, it does not unmount it: a reply being written keeps streaming, a
   permission keeps waiting. A view, on the other hand, mounts when its tab
   comes to the front and reloads its data.
--------------------------------------------------------------------------- */
export function AppShell({ settings }: { settings: Settings }) {
  usePluginSession(settings);
  const tabs = useTabs();
  /* The views of the plugins that run and that the interface knows how to
     draw; a tab whose plugin is off is not shown. */
  const views = enabledViews(settings).filter((v) => VIEWS[v.id]);
  const visible = tabs.open.filter((t) => views.some((v) => v.id === t.view));
  const active = visible.some((t) => t.view === tabs.active) ? tabs.active : HOME;
  const current = visible.find((t) => t.view === active);
  const entry = current ? viewEntry(current.view) : undefined;

  return (
    <div className="shell">
      <TabBar settings={settings} views={views} tabs={visible} active={active} />
      <div className="shell-body">
        <div className="shell-pane" hidden={active !== HOME}>
          <ChatShell settings={settings} />
        </div>
        {current && entry && (
          <div className="shell-pane" key={current.view}>
            <ViewFrame entry={entry} tab={current} settings={settings} />
          </div>
        )}
      </div>
    </div>
  );
}
