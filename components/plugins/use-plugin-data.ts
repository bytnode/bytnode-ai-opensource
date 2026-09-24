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

export function usePluginData<T>(plugin: string, action: string, settings: Settings, params: Record<string, unknown> = {}) {
  const [round, setRound] = useState(0);
  const query = JSON.stringify(params);
  const key = `${plugin}/${action}/${query}`;
  const [loaded, setLoaded] = useState<Loaded<T>>({ round: -1, query });
  const keys = settings.keys;
  const reload = useCallback(() => setRound((r) => r + 1), []);

  useEffect(() => {
    let alive = true;
    callPlugin<T>(plugin, action, JSON.parse(query) as Record<string, unknown>, { bytnodeKey: keys.bytnode, exchangeAccounts: keys.exchanges }).then(
      (data) => {
        remember(`${plugin}/${action}/${query}`, data);
        if (alive) setLoaded({ round, query, data });
      },
      (e: Error) => alive && setLoaded((prev) => ({ round, query, data: prev.data, error: e.message })),
    );
    return () => {
      alive = false;
    };
  }, [plugin, action, query, keys, round]);

  /* These parameters' own answer when there is one — just read, or kept
     from an earlier visit — else the last answer, whatever it was for. */
  const own = loaded.query === query && loaded.data !== undefined;
  const data = own ? loaded.data : remembered.has(key) ? (remembered.get(key) as T) : loaded.data;
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
