import { resolveWorkspace } from "@/lib/server/workspace";
import type { Transport } from "@/lib/tools/transport";
import { definePlugin } from "../core/contract";
import type { ReportService } from "../report-export/service";
import type { SchedulerService } from "../scheduler/service";
import { history, snapshotOf, summarize, type Snapshot } from "./aggregate";
import { priceBook, readAccounts } from "./collect";
import { portfolioManifest } from "./manifest";
import { moneyIn } from "./money";
import { portfolioHistoryTool } from "./portfolio-history";
import { portfolioSummaryTool } from "./portfolio-summary";
import { exportSections } from "./present";
import { candles } from "../shared/prices";
import type { Candle } from "../shared/candle";
import { assetsOf, estimateHistory, type Holdings } from "./backfill";

/* The consolidated portfolio: two read-only tools, a daily snapshot of the
   total while the app is open (when the scheduler runs), and the view's
   actions — the summary, the history, and the export as a report (when
   the report export runs). */

const SNAPSHOTS = "snapshots.jsonl";
const MAX_SNAPSHOTS = 3650;

export const portfolioPlugin = definePlugin({
  manifest: portfolioManifest,
  setup(ctx) {
    const currency = () => String(ctx.config().currency);
    const snapshots = () => ctx.store.lines<Snapshot>(SNAPSHOTS);

    ctx.tool(portfolioSummaryTool(currency));
    ctx.tool(portfolioHistoryTool(snapshots, currency));

    ctx.optional<SchedulerService>("scheduler")?.job({
      id: "snapshot",
      title: "Portfolio snapshot",
      every: `daily at ${String(ctx.config().snapshotAt)}`,
      catchUp: "run-once-on-start",
      async run({ session, signal }) {
        if (session.exchangeAccounts.length === 0) return "No exchange account: nothing to record.";
        const reads = await readAccounts(session.exchangeAccounts);
        const s = summarize(reads, await priceBook(reads, { bytnodeKey: session.bytnodeKey, accounts: session.exchangeAccounts, signal }));
        await ctx.store.append(SNAPSHOTS, snapshotOf(s, new Date()), MAX_SNAPSHOTS);
        return `Total ${s.totalUsd.toFixed(2)} USD across the live accounts.`;
      },
    });

    const current = async (wanted: unknown, transport: Pick<Transport, "bytnodeKey" | "exchangeAccounts">, signal: AbortSignal) => {
      const reads = await readAccounts(transport.exchangeAccounts);
      const [book, money] = await Promise.all([priceBook(reads, { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal }), moneyIn(wanted, currency())]);
      return { summary: summarize(reads, book), money, at: new Date().toISOString() };
    };

    ctx.api("summary", async (params, { transport, signal }) => current(params.currency, transport, signal));
    ctx.api("history", async (params) => {
      const days = typeof params.days === "number" ? params.days : 90;
      return { points: history(await snapshots(), days, new Date()) };
    });
    /* The history before the snapshots, estimated: today's holdings (sent
       by the view, from its summary) at each past day's close — BytNode's
       daily klines, else an account's exchange. */
    ctx.api("backfill", async (params, { transport, signal }) => {
      const days = Math.max(7, Math.min(365, typeof params.days === "number" ? Math.round(params.days) : 365));
      const holdings: Holdings = (Array.isArray(params.holdings) ? params.holdings : [])
        .filter((h): h is { id: string; assets: unknown[] } => typeof h?.id === "string" && Array.isArray(h.assets))
        .map((h) => ({ id: h.id, assets: h.assets.flatMap((a) => (typeof (a as { asset?: unknown }).asset === "string" && typeof (a as { amount?: unknown }).amount === "number" ? [a as { asset: string; amount: number }] : [])) }));
      const closes: Record<string, Candle[]> = {};
      await Promise.all(
        assetsOf(holdings).map(async (asset) => {
          const r = await candles(`${asset}/USDT`, "1d", days + 1, { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal });
          if ("candles" in r) closes[asset] = r.candles;
        }),
      );
      return estimateHistory(holdings, closes);
    });
    ctx.api("export", async (params, { transport, signal }) => {
      const report = ctx.optional<ReportService>("report-export");
      if (!report) throw new Error("Report export is off: switch it on in Settings → Plugins.");
      const agentId = typeof params.agentId === "string" ? params.agentId : "";
      const workspace = await resolveWorkspace(agentId, typeof params.workspace === "string" ? params.workspace : "");
      const { summary, money, at } = await current(params.currency, transport, signal);
      const date = at.slice(0, 16).replace("T", " ") + " UTC";
      const labels = transport.exchangeAccounts.map((a) => a.label).join(", ");
      const written = await report.write({
        workspace,
        scope: "workspace",
        title: `Portfolio — ${at.slice(0, 10)}`,
        summary: `${(summary.totalUsd * money.perUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${money.currency} across the live accounts.`,
        sections: exportSections(summary, history(await snapshots(), 90, new Date()), money),
        sources: [
          { name: `Exchange balances and positions (${labels})`, date },
          { name: "Valuation: BytNode prices, exchange tickers where BytNode has none", date },
          ...(money.currency === "USD" ? [] : [{ name: `Exchange rate (${money.rateNote})`, date }]),
        ],
        author: "BytNode-AI · Portfolio",
      });
      return { path: written.rel, agentId, workspace };
    });
  },
});
