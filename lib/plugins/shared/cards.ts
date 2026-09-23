import type { ToolCard } from "@/lib/tools/types";

/* ---------------------------------------------------------------------------
   The generic cards a plugin shows in the thread (drawn by
   `components/plugins/cards.tsx`): a few labelled figures, a small table,
   or a file to open. Kept small — they are stored with the conversation. A
   badge (PAPER, LIVE, TESTNET) says what the figures are about.
--------------------------------------------------------------------------- */

export type CardBadge = "PAPER" | "LIVE" | "TESTNET";

export type FactsCard = { title: string; rows: Array<{ label: string; value: string }>; note?: string; badge?: CardBadge };
export type TableCard = { title: string; columns: string[]; rows: string[][]; note?: string; badge?: CardBadge };
/** A file written in the workspace, to open from the thread. */
export type FileCard = { title: string; path: string };

const MAX_ROWS = 30;

export function factsCard(title: string, rows: Array<[string, string]>, extra: { note?: string; badge?: CardBadge } = {}): ToolCard {
  const data: FactsCard = { title, rows: rows.map(([label, value]) => ({ label, value })), ...extra };
  return { kind: "facts", data };
}

export function tableCard(title: string, columns: string[], rows: string[][], extra: { note?: string; badge?: CardBadge } = {}): ToolCard {
  const cut = rows.length > MAX_ROWS;
  const data: TableCard = {
    title,
    columns,
    rows: rows.slice(0, MAX_ROWS),
    ...extra,
    ...(cut ? { note: [extra.note, `${rows.length - MAX_ROWS} more rows in the tool's output.`].filter(Boolean).join(" ") } : {}),
  };
  return { kind: "table", data };
}

export function fileCard(title: string, path: string): ToolCard {
  const data: FileCard = { title, path };
  return { kind: "file", data };
}
