"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { callPlugin } from "@/lib/plugins/client";
import type { Transport } from "@/lib/tools/transport";

/* ---------------------------------------------------------------------------
   A view's data: one action of its plugin, called with the user's keys and
   ALL their exchange accounts (a view is the user's, not an agent's).
   `reload` calls it again; the previous data stays on screen meanwhile.
--------------------------------------------------------------------------- */

export const viewTransport = (settings: Settings): Partial<Transport> => ({ bytnodeKey: settings.keys.bytnode, exchangeAccounts: settings.keys.exchanges });

type Loaded<T> = { round: number; data?: T; error?: string };

export function usePluginData<T>(plugin: string, action: string, settings: Settings, params: Record<string, unknown> = {}) {
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T>>({ round: -1 });
  const query = JSON.stringify(params);
  const keys = settings.keys;

  useEffect(() => {
    let alive = true;
    callPlugin<T>(plugin, action, JSON.parse(query) as Record<string, unknown>, { bytnodeKey: keys.bytnode, exchangeAccounts: keys.exchanges }).then(
      (data) => alive && setLoaded({ round, data }),
      (e: Error) => alive && setLoaded((prev) => ({ round, data: prev.data, error: e.message })),
    );
    return () => {
      alive = false;
    };
  }, [plugin, action, query, keys, round]);

  return {
    data: loaded.data,
    error: loaded.round === round ? loaded.error : undefined,
    loading: loaded.round !== round,
    reload: () => setRound((r) => r + 1),
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
