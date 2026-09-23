import type { Summary, Snapshot } from "./aggregate";

/* The portfolio in words: for the agent (the tool's output), for the thread
   (the card's figures) and for the exported report. Amounts in the chosen
   currency; the rate and its source are always said. Pure, tested. */

export type Money = { currency: string; perUsd: number; rateNote: string };

const amount = (usd: number, m: Money) => `${(usd * m.perUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, " ")} ${m.currency}`;
const pct = (share: number) => `${(share * 100).toFixed(1)} %`;
const num = (n: number | null) => (n === null ? "—" : Number(n.toPrecision(8)).toString());

export function summaryLines(s: Summary, m: Money, at: Date): string[] {
  const lines = [`Portfolio — ${at.toISOString().slice(0, 16).replace("T", " ")} UTC, in ${m.currency}${m.currency === "USD" ? "" : ` (${m.rateNote})`}:`];
  lines.push(`Total, live accounts: ${amount(s.totalUsd, m)}${s.unpriced.length ? " (unpriced assets excluded)" : ""}.`);
  if (s.testnetUsd > 0) lines.push(`Testnet accounts, not counted: ${amount(s.testnetUsd, m)}.`);
  if (s.assets.length) lines.push(`By asset: ${s.assets.map((a) => `${a.asset} ${pct(a.share)} (${amount(a.usd, m)})`).join(" · ")}.`);
  lines.push(`By account: ${s.accounts.map((a) => `${a.label}${a.testnet ? " [testnet]" : ""} ${amount(a.usd, m)}${a.error ? ` — could not read: ${a.error}` : ""}`).join(" · ")}.`);
  if (s.positions.length) {
    lines.push("Open positions:");
    for (const p of s.positions) lines.push(`- ${p.label}${p.testnet ? " [testnet]" : ""}: ${p.symbol} ${p.side} ${num(p.size)} @ ${num(p.entry)}, mark ${num(p.mark)}, PnL ${num(p.pnl)}${p.leverage ? ` ×${p.leverage}` : ""}${p.liquidation ? `, liquidation ${num(p.liquidation)}` : ""}`);
    lines.push(`Unrealized PnL (live): ${amount(s.unrealizedPnl, m)}.`);
  }
  if (s.unpriced.length) lines.push(`Unpriced, not counted: ${s.unpriced.map((u) => `${u.asset} ${num(u.amount)} (${u.label})`).join(", ")}.`);
  return lines;
}

export function historyLines(points: Snapshot[], m: Money, days: number): string[] {
  if (points.length === 0) return [`No snapshot in the last ${days} days: the portfolio records one a day, while the app is open.`];
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((p) => p.totalUsd);
  const diff = last.totalUsd - first.totalUsd;
  return [
    `Portfolio over ${days} days (${points.length} daily snapshot${points.length > 1 ? "s" : ""}, in ${m.currency}${m.currency === "USD" ? "" : `, converted at today's rate (${m.rateNote})`}):`,
    `${first.date}: ${amount(first.totalUsd, m)} → ${last.date}: ${amount(last.totalUsd, m)} (${diff >= 0 ? "+" : "−"}${amount(Math.abs(diff), m)}, ${first.totalUsd > 0 ? `${((diff / first.totalUsd) * 100).toFixed(2)} %` : "—"}).`,
    `Low ${amount(Math.min(...values), m)} · high ${amount(Math.max(...values), m)}.`,
    ...points.map((p) => `${p.date}: ${amount(p.totalUsd, m)}`),
  ];
}

/** The exported report's sections, in Markdown. */
export function exportSections(s: Summary, points: Snapshot[], m: Money): Array<{ heading: string; markdown: string }> {
  const sections = [
    {
      heading: "Total",
      markdown: [`**${amount(s.totalUsd, m)}** across the live accounts${s.testnetUsd > 0 ? `; testnet accounts, not counted: ${amount(s.testnetUsd, m)}` : ""}.`, m.currency === "USD" ? "" : `Converted at ${m.rateNote}.`].filter(Boolean).join(" "),
    },
    {
      heading: "By asset",
      markdown: ["| Asset | Amount | Value | Share |", "|---|---:|---:|---:|", ...s.assets.map((a) => `| ${a.asset} | ${num(a.amount)} | ${amount(a.usd, m)} | ${pct(a.share)} |`)].join("\n"),
    },
    {
      heading: "By account",
      markdown: ["| Account | Exchange | Value | Note |", "|---|---|---:|---|", ...s.accounts.map((a) => `| ${a.label} | ${a.exchange}${a.testnet ? " (testnet)" : ""} | ${amount(a.usd, m)} | ${a.error ?? (a.unpriced ? `${a.unpriced} unpriced asset(s)` : "")} |`)].join("\n"),
    },
  ];
  if (s.positions.length) {
    sections.push({
      heading: "Open positions",
      markdown: ["| Account | Pair | Side | Size | Entry | Mark | PnL |", "|---|---|---|---:|---:|---:|---:|", ...s.positions.map((p) => `| ${p.label} | ${p.symbol} | ${p.side} | ${num(p.size)} | ${num(p.entry)} | ${num(p.mark)} | ${num(p.pnl)} |`)].join("\n"),
    });
  }
  if (points.length > 1) {
    sections.push({ heading: "Evolution", markdown: ["| Date | Value |", "|---|---:|", ...points.map((p) => `| ${p.date} | ${amount(p.totalUsd, m)} |`)].join("\n") });
  }
  if (s.unpriced.length) sections.push({ heading: "Not counted", markdown: s.unpriced.map((u) => `- ${u.asset} ${num(u.amount)} (${u.label}): no price available.`).join("\n") });
  return sections;
}
