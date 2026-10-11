"use client";

import type { PluginManifest } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { viewEntry, type ViewEntry } from "@/lib/plugins/catalog";
import { useMessages } from "@/lib/i18n/react";
import { viewText } from "@/lib/i18n/plugin-text";
import { goToConversation } from "@/lib/state/navigation";
import { ensureConversation } from "@/lib/state/scheduled-runs";
import { HOME, activateTab, closeViews, openView, type ViewTab } from "@/lib/state/tabs";
import { SIDEBAR_WIDTH } from "@/lib/state/ui";
import { Close } from "@/components/ui/icons";
import { NotificationCenter } from "./notification-center";
import { TabIcon } from "./tab-icons";
import { TabPreview, useTabPreview } from "./tab-preview";
import { ViewsMenu } from "./views-menu";

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

/** A mouse wheel turns vertically only: on Windows / Linux (no trackpad)
    an overflowing strip could not be scrolled at all. */
function wheelSideways(e: React.WheelEvent<HTMLDivElement>) {
  const strip = e.currentTarget;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) strip.scrollLeft += e.deltaY;
}

/** `extra`: the plugins written by agents that run (their tabs). */
type Props = { settings: Settings; views: ViewEntry[]; extra: PluginManifest[]; tabs: ViewTab[]; active: string };

export function TabBar({ settings, views, extra, tabs, active }: Props) {
  const m = useMessages();
  /* The preview under a tab the hand rests on (`tab-preview.tsx`). */
  const preview = useTabPreview();
  const hover = (view: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => preview.enter(view, e.currentTarget),
    onMouseLeave: preview.leave,
    onMouseDown: preview.hide,
  });
  const peekedEntry = preview.peek && preview.peek.view !== HOME ? viewEntry(preview.peek.view, extra) : undefined;
  const peeked = preview.peek ? (preview.peek.view === HOME ? { title: m.shell.conversations, description: m.shell.conversationsDescription } : peekedEntry ? viewText(peekedEntry.plugin.id, peekedEntry, m) : null) : null;
  return (
    <div className="tb" style={{ "--tb-home": `${SIDEBAR_WIDTH}px` } as React.CSSProperties}>
      <div className="tb-tabs" role="tablist" aria-label={m.shell.openPages} onScroll={preview.hide} onWheel={wheelSideways}>
        {/* Built like the others (a tab around its label); its width is
            the column's, not a share of the bar. */}
        <div className={`tb-tab tb-tab-home${active === HOME ? " is-on" : ""}`} {...hover(HOME)}>
          <button type="button" role="tab" aria-selected={active === HOME} className="tb-home" onClick={() => activateTab(HOME)}>
            <TabIcon view="home" className="tb-favicon" />
            <span className="tb-title">{m.shell.conversations}</span>
          </button>
        </div>
        {tabs.map((t) => {
          const entry = viewEntry(t.view, extra);
          if (!entry) return null;
          const on = active === t.view;
          const title = viewText(entry.plugin.id, entry, m).title;
          return (
            <div key={t.view} className={`tb-tab${on ? " is-on" : ""}`} {...hover(t.view)}>
              <span className="tb-sep" aria-hidden />
              <button type="button" role="tab" aria-selected={on} className="tb-label" onClick={() => activateTab(t.view)}>
                <TabIcon view={t.view} className="tb-favicon" />
                <span className="tb-title">{title}</span>
              </button>
              <button type="button" className="tb-close" onClick={() => closeViews([t.view])} aria-label={m.shell.closeTab(title)}>
                <Close />
              </button>
            </div>
          );
        })}
      </div>
      {/* A last rule closes the strip (hidden when the last tab is in
          front: its foot flares there), then "+" right after it — outside
          the strip, whose scrolling would cut its list off. */}
      <span className={`tb-end${tabs.length ? (active === tabs[tabs.length - 1].view ? " is-hidden" : "") : active === HOME ? " is-hidden" : ""}`} aria-hidden />
      <ViewsMenu views={views} open={tabs.map((t) => t.view)} active={active} onPick={openView} />
      <span className="tb-space" />
      {preview.peek && peeked && <TabPreview peek={preview.peek} title={peeked.title} description={peeked.description} asleep={preview.peek.view !== HOME && preview.peek.view !== active} />}
      <NotificationCenter settings={settings} onOpenConversation={(id) => void ensureConversation(id, settings).then(() => goToConversation(id))} />
    </div>
  );
}
