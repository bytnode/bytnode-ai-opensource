"use client";

import { useState } from "react";
import type { Settings } from "@/lib/domain/types";
import { callPlugin } from "@/lib/plugins/client";
import { usePlugins } from "@/lib/state/plugins";
import { File } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";
import { viewTransport } from "./use-plugin-data";
import { Problem } from "./bits";

/* ---------------------------------------------------------------------------
   "Export as a report", for a view whose plugin writes one through the
   report export (the portfolio, the paper trading): the button — only
   while the report export runs — and, under the toolbar, where the
   document was written in the active agent's workspace, or why not.
--------------------------------------------------------------------------- */

type Done = { href: string; path: string };

export function useReportExport(plugin: string, settings: Settings, params: Record<string, unknown> = {}) {
  const m = useMessages();
  const { status } = usePlugins();
  const available = status.some((s) => s.id === "report-export" && s.state === "active");
  const agent = settings.agents.find((a) => a.id === settings.activeAgentId) ?? settings.agents[0];
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      const r = await callPlugin<{ path: string; agentId: string; workspace: string }>(plugin, "export", { ...params, agentId: agent.id, workspace: agent.workspace ?? "" }, viewTransport(settings));
      setDone({ path: r.path, href: `/api/files?agentId=${encodeURIComponent(r.agentId)}&workspace=${encodeURIComponent(r.workspace)}&path=${encodeURIComponent(r.path)}` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const button = (disabled = false) =>
    available && agent ? (
      <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={busy || disabled}>
        <File />
        {busy ? m.plugins.report.exporting : m.plugins.report.export}
      </button>
    ) : null;

  const result = (
    <>
      {done && (
        <p className="pv-note">
          {m.plugins.report.written(agent?.name ?? "")}{" "}
          <a href={done.href} target="_blank" rel="noreferrer" className="mono">
            {done.path}
          </a>
        </p>
      )}
      {error && <Problem message={error} />}
    </>
  );

  return { button, result };
}
