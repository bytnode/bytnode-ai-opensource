"use client";

import { useCallback, useEffect, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { callPlugin } from "@/lib/plugins/client";
import type { Transport } from "@/lib/tools/transport";

/* ---------------------------------------------------------------------------
   A view's data: one action of its plugin, called with the user's keys and
   ALL their exchange accounts (a view is the user's, not an agent's).
   `reload` (stable) calls it again; the previous data stays on screen
   meanwhile.

   Every answer is also kept, by action and parameters, for the page's
   life (`remembered`): coming back to parameters already read — an asset
   seen a minute ago, a month already visited — shows their last answer at
   once, and the fresh one replaces it silently. Nothing is ever shown
   blank a second time.

   `keep` carries that past a reload: an action's last answers (a few, the
   newest) are also written to the browser (`agentchat:view:<plugin>/
   <action>`) and put back in `remembered` at the first read — the view
   opens on what it showed last, then updates. `"latest"` also shows the
   newest kept answer when none matches the parameters (the portfolio's
   history, asked with today's holdings: yesterday's curve beats a blank
   one); `"exact"` never shows one read for other parameters (a chart of
   another asset). Storage may be full or refused: then nothing is kept.
--------------------------------------------------------------------------- */

export const viewTransport = (settings: Settings): Partial<Transport> => ({ bytnodeKey: settings.keys.bytnode, exchangeAccounts: settings.keys.exchanges });

type Loaded<T> = { round: number; query: string; data?: T; error?: string };

/** The last answer per action and parameters; the oldest go first past
    `KEPT` (a Map keeps its insertion order: a re-read moves to the end). */
const remembered = new Map<string, unknown>();
const KEPT = 300;

function remember(key: string, data: unknown) {
  remembered.delete(key);
  remembered.set(key, data);
  if (remembered.size > KEPT) remembered.delete(remembered.keys().next().value as string);
}

type Keep = "exact" | "latest";
type Stored = Array<{ query: string; data: unknown }>;

/** Answers kept per action across reloads (the newest last). */
const STORED_PER_ACTION = 6;
const storageKey = (action: string) => `agentchat:view:${action}`;
/** Actions already put back from storage in this page. */
const restored = new Map<string, Stored>();

function readStored(action: string): Stored {
  const hit = restored.get(action);
  if (hit) return hit;
  let list: Stored = [];
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(storageKey(action));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((e): e is Stored[number] => typeof e?.query === "string" && e.data !== undefined);
  } catch {
    /* unreadable: start empty */
  }
  restored.set(action, list);
  for (const e of list) if (!remembered.has(`${action}/${e.query}`)) remember(`${action}/${e.query}`, e.data);
  return list;
}

function writeStored(action: string, query: string, data: unknown) {
  const list = [...readStored(action).filter((e) => e.query !== query), { query, data }].slice(-STORED_PER_ACTION);
  restored.set(action, list);
  try {
    window.localStorage.setItem(storageKey(action), JSON.stringify(list));
  } catch {
    /* full or refused: kept for this page only */
  }
}

export function usePluginData<T>(plugin: string, action: string, settings: Settings, params: Record<string, unknown> = {}, options: { keep?: Keep } = {}) {
  const [round, setRound] = useState(0);
  const query = JSON.stringify(params);
  const key = `${plugin}/${action}/${query}`;
  const [loaded, setLoaded] = useState<Loaded<T>>({ round: -1, query });
  const keys = settings.keys;
  const reload = useCallback(() => setRound((r) => r + 1), []);
  const keep = options.keep;
  const stored = keep ? readStored(`${plugin}/${action}`) : null;

  useEffect(() => {
    let alive = true;
    callPlugin<T>(plugin, action, JSON.parse(query) as Record<string, unknown>, { bytnodeKey: keys.bytnode, exchangeAccounts: keys.exchanges }).then(
      (data) => {
        remember(`${plugin}/${action}/${query}`, data);
        if (keep) writeStored(`${plugin}/${action}`, query, data);
        if (alive) setLoaded({ round, query, data });
      },
      (e: Error) => alive && setLoaded((prev) => ({ round, query, data: prev.data, error: e.message })),
    );
    return () => {
      alive = false;
    };
  }, [plugin, action, query, keys, round, keep]);

  /* These parameters' own answer when there is one — just read, or kept
     from an earlier visit — else the last answer, whatever it was for. */
  const own = loaded.query === query && loaded.data !== undefined;
  const newest = keep === "latest" && stored?.length ? (stored[stored.length - 1].data as T) : undefined;
  const data = own ? loaded.data : remembered.has(key) ? (remembered.get(key) as T) : (loaded.data ?? newest);
  return {
    data,
    error: loaded.round === round && loaded.query === query ? loaded.error : undefined,
    loading: loaded.round !== round || loaded.query !== query,
    reload,
  };
}

/** A view's action that changes something, then the data reloads. */
export async function act(plugin: string, action: string, params: Record<string, unknown>, settings: Settings): Promise<string | null> {
  try {
    await callPlugin(plugin, action, params, viewTransport(settings));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
