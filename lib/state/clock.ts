"use client";

import { useSyncExternalStore } from "react";

/* ---------------------------------------------------------------------------
   The minute, for the « 2 h ago » of a list. A render never reads the clock
   itself (the React Compiler rules): it reads this store, which moves once a
   minute while someone listens. On the server, and during hydration, the
   time is 0 — the callers show nothing relative until the client's first
   read.
--------------------------------------------------------------------------- */

const MINUTE = 60_000;
let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const tick = () => {
  now = Date.now();
  for (const l of listeners) l();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(tick, MINUTE);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const read = () => (now === 0 ? (now = Date.now()) : now);

/** Now, to the minute; 0 on the server. */
export const useNow = (): number => useSyncExternalStore(subscribe, read, () => 0);
