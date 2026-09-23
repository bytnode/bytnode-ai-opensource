"use client";

import { useEffect, useRef } from "react";
import type { Settings } from "@/lib/domain/types";
import { syncSession } from "@/lib/plugins/client";
import { refreshNotifications, refreshPlugins, setPluginStatus } from "@/lib/state/plugins";

/* ---------------------------------------------------------------------------
   The open tab keeps the server informed, and listens.

   - The settings (keys included) go to the server when the app opens,
     shortly after every change, and every minute: the background works
     only with what a live tab gave it, and forgets it when no tab speaks
     any more (`lib/plugins/core/session.ts`).
   - The notifications are read every 15 s and when the window comes back;
     a new one raises the browser's notification when the page is not in
     front — if the user allowed them.
--------------------------------------------------------------------------- */

const HEARTBEAT = 60_000;
const POLL = 15_000;
const DEBOUNCE = 400;

export function usePluginSession(settings: Settings) {
  const latest = useRef(settings);

  useEffect(() => {
    latest.current = settings;
    const t = setTimeout(() => {
      void syncSession(settings)
        .then(setPluginStatus)
        .then(refreshPlugins)
        .catch(() => {});
    }, DEBOUNCE);
    return () => clearTimeout(t);
  }, [settings]);

  useEffect(() => {
    const beat = setInterval(() => void syncSession(latest.current).then(setPluginStatus).catch(() => {}), HEARTBEAT);
    return () => clearInterval(beat);
  }, []);

  useEffect(() => {
    let first = true;
    const poll = async () => {
      const fresh = await refreshNotifications();
      /* The first read only fills the list: nothing "new" to announce. */
      if (first) {
        first = false;
        return;
      }
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (document.visibilityState === "visible" && document.hasFocus()) return;
      for (const n of fresh.filter((x) => !x.read)) new Notification(n.title, { body: n.body, tag: n.id });
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
