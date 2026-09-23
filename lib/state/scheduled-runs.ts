"use client";

import type { Settings } from "@/lib/domain/types";
import { PLUGIN_MANIFESTS } from "@/lib/plugins/catalog";
import { callPlugin } from "@/lib/plugins/client";
import { enabledPlugins } from "@/lib/plugins/core/state";
import { importBatch } from "@/lib/plugins/scheduler/conversation";
import { runConversationId, type RunRecord } from "@/lib/plugins/scheduler/tasks";
import { BrowserStorage } from "@/lib/storage/storage";
import { getConversation, saveConversation } from "./conversations";

/* ---------------------------------------------------------------------------
   The reports of the scheduled tasks, brought into the conversations.

   The server keeps them in its run log (`plugins/scheduler/runs.jsonl`);
   the conversations live in this browser. So the open tab asks for the
   runs finished since the last one it imported, and turns each into a
   conversation. The cursor is kept here: a conversation the user deletes
   is not imported again.
--------------------------------------------------------------------------- */

const KEY = "agentchat:imported-runs";
const storage = new BrowserStorage();

let inFlight: Promise<void> | null = null;

/** Imports the runs not seen yet. Never throws: a failed import is retried
    at the next call. */
export function importRuns(settings: Settings): Promise<void> {
  if (!enabledPlugins(PLUGIN_MANIFESTS, settings.plugins).includes("scheduler")) return Promise.resolve();
  inFlight ??= (async () => {
    try {
      const since = storage.get(KEY) ?? "";
      const runs = await callPlugin<RunRecord[]>("scheduler", "runs", { since });
      const existing = new Set(runs.map((r) => runConversationId(r.id)).filter((id) => getConversation(id)));
      const batch = importBatch(runs, settings.agents, existing, since);
      for (const c of batch.conversations) saveConversation(c);
      if (batch.since !== since) storage.set(KEY, batch.since);
    } catch {
      /* the scheduler is off, or the server is restarting */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Opens a conversation from a notification: a task's report may not be
    imported yet. */
export async function ensureConversation(id: string, settings: Settings): Promise<void> {
  if (!getConversation(id)) await importRuns(settings);
}
