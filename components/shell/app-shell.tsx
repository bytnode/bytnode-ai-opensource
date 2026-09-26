"use client";

import { useEffect } from "react";
import type { Settings } from "@/lib/domain/types";
import { enabledViews, viewEntry } from "@/lib/plugins/catalog";
import { HOME, useTabs } from "@/lib/state/tabs";
import { ChatShell } from "@/components/chat/chat-shell";
import { ViewFrame } from "@/components/plugins/view-frame";
import { VIEWS } from "@/components/plugins/views";
import { ViewActive } from "@/components/plugins/view-activity";
import { runningManifests, useUserPlugins } from "@/lib/state/user-plugins";
import { PluginReview } from "./plugin-review";
import { TabBar } from "./tab-bar";
import { usePluginSession } from "./use-plugin-session";
import "./shell.css";

/** A file dropped anywhere but on a drop zone (the composer, the context
    files) made the browser OPEN it in place of the app — a reply being
    written was cut. Nothing happens there any more; a drop zone that takes
    the file cancels the event first and is left alone. */
function useNoStrayDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    };
    const drop = (e: DragEvent) => {
      if (!e.defaultPrevented && e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

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
  useNoStrayDrop();
  const tabs = useTabs();
  /* The views of the plugins that run and that the interface knows how to
     draw — a plugin written by an agent draws its own, in a frame; a tab
     whose plugin is off is not shown. */
  const extra = runningManifests(useUserPlugins());
  const views = enabledViews(settings, extra).filter((v) => VIEWS[v.id] || v.plugin.tier === "user");
  const visible = tabs.open.filter((t) => views.some((v) => v.id === t.view));
  const active = visible.some((t) => t.view === tabs.active) ? tabs.active : HOME;

  return (
    <div className="shell">
      <TabBar settings={settings} views={views} extra={extra} tabs={visible} active={active} />
      <div className="shell-body">
        {/* `data-view`: the tab bar's preview finds the page it shows. */}
        <div className="shell-pane" data-view={HOME} hidden={active !== HOME}>
          <ChatShell settings={settings} />
        </div>
        {visible.map((tab) => {
          const entry = viewEntry(tab.view, extra);
          if (!entry) return null;
          const front = tab.view === active;
          return (
            <div key={tab.view} className="shell-pane" data-view={tab.view} hidden={!front}>
              <ViewActive value={front}>
                <ViewFrame entry={entry} tab={tab} settings={settings} />
              </ViewActive>
            </div>
          );
        })}
      </div>
      <PluginReview settings={settings} />
    </div>
  );
}
