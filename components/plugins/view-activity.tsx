"use client";

import { createContext, useContext, useEffect, useRef } from "react";

/* ---------------------------------------------------------------------------
   A view in its tab: in front, or asleep behind another tab.

   The views stay mounted while their tab is open (`app-shell.tsx`): coming
   back to one finds it as it was left — its data, its scroll, its state —
   instead of loading it again. Asleep, it does no work: its timers stop,
   and when it comes back to the front it catches up once, quietly (the
   data on screen stays while the new one comes).
--------------------------------------------------------------------------- */

export const ViewActive = createContext(true);

/** Whether the view's tab is the one in front. */
export const useViewActive = () => useContext(ViewActive);

/** Calls `fn` when the view comes back to the front after sleeping (not
    when it first mounts: it has just loaded). `fn` must be stable. */
export function useOnWake(fn: () => void) {
  const active = useViewActive();
  const was = useRef(active);
  useEffect(() => {
    if (active && !was.current) fn();
    was.current = active;
  }, [active, fn]);
}

/** Calls `fn` every `ms` while the view is in front, and once when it wakes
    up. `fn` must be stable. */
export function useAwakeInterval(fn: () => void, ms: number) {
  const active = useViewActive();
  useOnWake(fn);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [active, fn, ms]);
}
