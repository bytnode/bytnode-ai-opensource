"use client";

import type { ToolCard } from "@/lib/tools/types";
import type { CardBadge, FactsCard, FileCard, TableCard } from "@/lib/plugins/shared/cards";
import { viewEntry } from "@/lib/plugins/catalog";
import { openView } from "@/lib/state/tabs";
import { runningManifests, useUserPlugins } from "@/lib/state/user-plugins";
import { useSettings } from "@/lib/state/settings";
import { PluginConsent } from "./plugin-consent";
import { ArrowRight, File } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";
import { pluginText, viewText } from "@/lib/i18n/plugin-text";
import "./plugins.css";

/* ---------------------------------------------------------------------------
   What a plugin shows in the thread, under its tool's row: a few figures,
   a small table — the answer at a glance, the raw output one click away —
   and, for OpenView, the way back to the tab it opened.
--------------------------------------------------------------------------- */

export function Badge({ badge }: { badge: CardBadge }) {
  return <span className={`xch-badge${badge === "LIVE" ? " is-live" : badge === "PAPER" ? " is-paper" : ""}`}>{badge}</span>;
}

function Facts({ card }: { card: FactsCard }) {
  return (
    <div className="pc">
      <p className="pc-title">
        {card.badge && <Badge badge={card.badge} />}
        {card.title}
      </p>
      <dl className="pc-facts">
        {card.rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className="mono">{r.value}</dd>
          </div>
        ))}
      </dl>
      {card.note && <p className="pc-note">{card.note}</p>}
    </div>
  );
}

function Table({ card }: { card: TableCard }) {
  return (
    <div className="pc">
      <p className="pc-title">
        {card.badge && <Badge badge={card.badge} />}
        {card.title}
      </p>
      <div className="pc-scroll">
        <table className="pc-table">
          <thead>
            <tr>
              {card.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className={j > 0 ? "mono" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.note && <p className="pc-note">{card.note}</p>}
    </div>
  );
}

/** A file written in the workspace: opened in a new browser tab, served
    inert (`/api/files`: sandbox, nothing loaded from outside). */
function FileLink({ card, fileUrl }: { card: FileCard; fileUrl?: (rel: string) => string }) {
  if (!fileUrl) return null;
  return (
    <a className="pc pc-link" href={fileUrl(card.path)} target="_blank" rel="noreferrer">
      <span>
        <File /> {card.title}
        <small className="mono">{card.path}</small>
      </span>
      <ArrowRight />
    </a>
  );
}

export function ToolCardView({ card, fileUrl }: { card: ToolCard; fileUrl?: (rel: string) => string }) {
  if (card.kind === "facts") return <Facts card={card.data as FactsCard} />;
  if (card.kind === "table") return <Table card={card.data as TableCard} />;
  if (card.kind === "file") return <FileLink card={card.data as FileCard} fileUrl={fileUrl} />;
  if (card.kind === "plugin-review") return <ReviewCard pluginId={String(card.data.pluginId)} digest={typeof card.data.digest === "string" ? card.data.digest : undefined} />;
  return null;
}

/** Under PluginActivate: the plugin an agent wrote waits for the user —
    the consent block itself, in the conversation. */
function ReviewCard({ pluginId, digest }: { pluginId: string; digest?: string }) {
  const { settings } = useSettings();
  return <PluginConsent pluginId={pluginId} digest={digest} settings={settings} />;
}

/** "Portfolio opened →": back to the tab the agent opened. */
export function OpenViewCard({ view, params }: { view: string; params?: Record<string, unknown> }) {
  const m = useMessages();
  const entry = viewEntry(view, runningManifests(useUserPlugins()));
  if (!entry) return null;
  return (
    <button type="button" className="pc pc-link" onClick={() => openView(view, params)}>
      <span>
        {m.plugins.viewOpened(viewText(entry.plugin.id, entry, m).title)}
        <small>{pluginText(entry.plugin, m).name}</small>
      </span>
      <ArrowRight />
    </button>
  );
}
