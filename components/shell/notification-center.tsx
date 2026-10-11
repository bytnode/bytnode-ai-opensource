"use client";

import { useState } from "react";
import type { AppNotification } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { pluginManifest } from "@/lib/plugins/catalog";
import { useMessages } from "@/lib/i18n/react";
import { pluginText } from "@/lib/i18n/plugin-text";
import { dateTag } from "@/lib/i18n/store";
import { changeNotifications, refreshNotifications, useNotifications } from "@/lib/state/plugins";
import { openView } from "@/lib/state/tabs";
import { openReview, useUserPlugins } from "@/lib/state/user-plugins";
import { Bell, Close } from "@/components/ui/icons";
import { ConfirmationPrompt } from "./confirmation-prompt";

/* ---------------------------------------------------------------------------
   The notification center, in the tab bar: a bell with the count of what
   is unread, a panel with the latest — an alert that fired, a purchase to
   confirm, a scheduled task done. Each one does what it says: open the
   view, open the conversation, or open the permission prompt of a parked
   order.
--------------------------------------------------------------------------- */

const when = (at: number) => {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString(dateTag(), { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString(dateTag(), { day: "numeric", month: "short" })} ${time}`;
};

/** A shipped plugin's name in the interface's language. */
const pluginName = (pluginId: string): string | undefined => {
  const manifest = pluginManifest(pluginId);
  return manifest ? pluginText(manifest).name : undefined;
};

type Props = { settings: Settings; onOpenConversation: (conversationId: string) => void };

export function NotificationCenter({ settings, onOpenConversation }: Props) {
  const m = useMessages();
  const list = useNotifications();
  const mine = useUserPlugins();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const unread = list.filter((n) => !n.read).length;
  const canAsk = typeof Notification !== "undefined" && Notification.permission === "default";

  const act = (n: AppNotification) => {
    void changeNotifications({ read: [n.id] });
    if (!n.action) return;
    setOpen(false);
    if (n.action.kind === "open-view") openView(n.action.view, n.action.params);
    else if (n.action.kind === "open-conversation") onOpenConversation(n.action.conversationId);
    else if (n.action.kind === "review-plugin") openReview(n.action.pluginId);
    else setConfirming(n.action.confirmationId);
  };

  return (
    <div className="nc">
      <button
        type="button"
        className={`tb-icon${open ? " is-on" : ""}`}
        onClick={() => {
          /* Opened: read again now rather than at the next poll. */
          if (!open) void refreshNotifications();
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-label={unread ? m.shell.notificationsUnread(unread) : m.shell.notifications}
        title={m.shell.notifications}
      >
        <Bell />
        {unread > 0 && <span className="nc-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <>
          <button type="button" className="nc-scrim" aria-label={m.shell.closeNotifications} onClick={() => setOpen(false)} />
          <div className="nc-panel" role="dialog" aria-label={m.shell.notifications}>
            <div className="nc-head">
              <span>{m.shell.notifications}</span>
              {list.length > 0 && (
                <span className="nc-head-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void changeNotifications({ read: "all" })} disabled={unread === 0}>
                    {m.shell.markAllRead}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void changeNotifications({ remove: "all" })}>
                    {m.shell.clear}
                  </button>
                </span>
              )}
            </div>
            {canAsk && (
              <button type="button" className="nc-allow" onClick={() => void Notification.requestPermission()}>
                {m.shell.allowDesktop}
              </button>
            )}
            {list.length === 0 ? (
              <p className="nc-empty">{m.shell.noNotifications}</p>
            ) : (
              <ul className="nc-list">
                {list.map((n) => (
                  <li key={n.id} className={`nc-item nc-${n.level}${n.read ? "" : " is-unread"}`}>
                    <button type="button" className="nc-main" onClick={() => act(n)}>
                      <span className="nc-title">{n.title}</span>
                      <span className="nc-body">{n.body}</span>
                      <span className="nc-meta">
                        {pluginName(n.plugin) ?? mine.find((p) => p.id === n.plugin)?.name ?? n.plugin} · {when(n.at)}
                        {n.action?.kind === "confirm" && <strong> · {m.shell.reviewAndConfirm}</strong>}
                      </span>
                    </button>
                    <button type="button" className="nc-x" onClick={() => void changeNotifications({ remove: [n.id] })} aria-label={m.common.remove}>
                      <Close />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {confirming && <ConfirmationPrompt confirmationId={confirming} settings={settings} onClose={() => setConfirming(null)} />}
    </div>
  );
}
