import { randomUUID } from "node:crypto";
import { resolveWorkspace } from "@/lib/server/workspace";
import type { Transport } from "@/lib/tools/transport";
import { definePlugin } from "../core/contract";
import type { ReportService } from "../report-export/service";
import { history, snapshotOf, summarize, type Snapshot } from "./aggregate";
import { priceBook, readAccounts } from "./collect";
import { portfolioManifest } from "./manifest";
import { moneyIn } from "./money";
import { portfolioHistoryTool } from "./portfolio-history";
import { portfolioSummaryTool } from "./portfolio-summary";
import { exportSections } from "./present";
import { candles } from "../shared/prices";
import type { Candle } from "../shared/candle";
import { balancesByDay, closeOn, flowsByDay, flowsOfMoves, lastDays, valueByDay, type Activity, type Coverage, type Holdings, type Move } from "./backfill";
import { readHistory } from "./ledger";
import type { Access } from "./permissions";
import { addBalances, savingsByDay, tradingPart } from "./savings";
import { STABLES } from "./aggregate";
import { addGroup, editGroup, removeGroup, type AccountGroup } from "./groups";
import { accountsKey, holdingsKey, holdingsOf, Warm } from "./warm";

/* The consolidated portfolio: two read-only tools, a daily snapshot of the
   total while the app is open (a job on the core's clock), and the view's
   actions — the summary, the history, and the export as a report (when
   the report export runs). The accounts' read and the rebuilt history are
   kept a while and read AHEAD, as soon as the accounts change (`warm.ts`):
   the tab and the widget open on them with no wait. */

const MINUTE = 60_000;
/** The view's history: 365 days back (`view.tsx`, HISTORY_DAYS − 1). */
const BACKFILL_DAYS = 365;
/** A shared read is not stopped by the caller that started it leaving. */
const NEVER = new AbortController().signal;

const SNAPSHOTS = "snapshots.jsonl";
/** The user's groups of accounts (ids only — `groups.ts`). */
const GROUPS = "groups.json";
const MAX_SNAPSHOTS = 3650;

export const portfolioPlugin = definePlugin({
  manifest: portfolioManifest,
  setup(ctx) {
    const currency = () => String(ctx.config().currency);
    const snapshots = () => ctx.store.lines<Snapshot>(SNAPSHOTS);

    ctx.tool(portfolioSummaryTool(currency));
    ctx.tool(portfolioHistoryTool(snapshots, currency));

    ctx.job({
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

    /* The accounts read and priced, a minute: the tab, the widget, an
       export and the preload asked at once share ONE read of the exchanges. */
    const reads = new Warm<{ summary: ReturnType<typeof summarize>; at: string }>(MINUTE);
    const read = (transport: Pick<Transport, "bytnodeKey" | "exchangeAccounts">) =>
      reads.get(accountsKey(transport.exchangeAccounts ?? [], transport.bytnodeKey ?? ""), async () => {
        const r = await readAccounts(transport.exchangeAccounts);
        return { summary: summarize(r, await priceBook(r, { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal: NEVER })), at: new Date().toISOString() };
      });
    const current = async (wanted: unknown, transport: Pick<Transport, "bytnodeKey" | "exchangeAccounts">) => {
      const [{ summary, at }, money] = await Promise.all([read(transport), moneyIn(wanted, currency())]);
      return { summary, money, at };
    };

    ctx.api("summary", async (params, { transport }) => current(params.currency, transport));
    /* The groups of accounts: the view's navigator lists them, the view
       cuts the summary and the history to each (`groups.ts`). */
    ctx.api("groups", async () => ctx.store.read<AccountGroup[]>(GROUPS, []));
    ctx.api("group", async (params) => {
      const id = typeof params.id === "string" ? params.id : "";
      let failed: string | null = null;
      let group: AccountGroup | undefined;
      await ctx.store.update<AccountGroup[]>(GROUPS, [], (list) => {
        const r: { groups: AccountGroup[]; group?: AccountGroup } | { error: string } =
          params.action === "create"
            ? addGroup(list, params.name, params.accountIds, randomUUID().slice(0, 8), new Date())
            : params.action === "edit"
              ? editGroup(list, id, { name: params.name, accountIds: params.accountIds })
              : params.action === "delete"
                ? removeGroup(list, id)
                : { error: "Expected `action`: create, edit or delete." };
        if ("error" in r) {
          failed = r.error;
          return list;
        }
        group = r.group;
        return r.groups;
      });
      if (failed) throw new Error(failed);
      return group ?? { deleted: id };
    });
    ctx.api("history", async (params) => {
      /* The tool's bounds (PortfolioHistory): a huge `days` made an invalid date. */
      const days = typeof params.days === "number" && Number.isFinite(params.days) ? Math.max(2, Math.min(3650, Math.round(params.days))) : 90;
      return { points: history(await snapshots(), days, new Date()) };
    });
    /* The history before the snapshots. Per live account: its real
       balances day by day, rebuilt from the exchange's ledger (today's
       holdings, sent by the view, walked back through every move); an
       exchange without a usable ledger keeps today's holdings — an
       estimate, said as such (`sources`). A Bybit account whose key reads
       Earn is rebuilt whole: the trading account from its ledger, Funding
       and Earn beside it (`savings.ts`) — the money that left them without
       a record the API gives shows as an outflow. Each day valued at its
       close: BytNode's daily klines, else an account's exchange. What each
       key cannot read is said back (`access`). */
    ctx.api("backfill", async (params, { transport }) => {
      const days = Math.max(7, Math.min(365, typeof params.days === "number" ? Math.round(params.days) : 365));
      const holdings: Holdings = (Array.isArray(params.holdings) ? params.holdings : [])
        .filter((h): h is { id: string; assets: unknown[] } => typeof h?.id === "string" && Array.isArray(h.assets))
        .map((h) => ({ id: h.id, assets: h.assets.flatMap((a) => (typeof (a as { asset?: unknown }).asset === "string" && typeof (a as { amount?: unknown }).amount === "number" ? [a as { asset: string; amount: number }] : [])) }));
      return backfillOf(holdings, days, transport);
    });
    /* The history rebuilt, an hour: hundreds of exchange calls on a Bybit
       account, read once (by the preload, most often). Keyed by the assets
       held, not their amounts (`holdingsKey`). */
    const rebuild = async (holdings: Holdings, days: number, transport: Pick<Transport, "bytnodeKey" | "exchangeAccounts">) => {
      const signal = NEVER;
      const dayList = lastDays(new Date(), days);
      const since = Date.parse(`${dayList[0]}T00:00:00Z`);
      const accounts = transport.exchangeAccounts ?? [];
      const sources: Record<string, "ledger" | "estimate"> = {};
      const balances: Record<string, Record<string, Record<string, number>>> = {};
      const coverage: Record<string, Record<string, Coverage>> = {};
      const activity: Activity[] = [];
      const ledgers: Record<string, Move[]> = {};
      const access: Record<string, Access> = {};
      /* The accounts rebuilt whole: their flows are the money in and out of
         the account, not the transfers between its wallets. */
      const whole = new Set<string>();
      /* The money found gone (or come) without a record, placed below once
         priced: a few cents of interest rounding are not shown. */
      const found: Activity[] = [];
      /* One account after the other: an exchange asked many things at once
         drops connections. */
      for (const h of holdings) {
        const current = Object.fromEntries(h.assets.map((a) => [a.asset, a.amount]));
        const account = accounts.find((a) => a.id === h.id);
        const history = account ? await readHistory(account, since, h.assets.map((a) => a.asset).filter((a) => !STABLES.has(a))) : null;
        sources[h.id] = history?.moves ? "ledger" : "estimate";
        if (history?.moves) ledgers[h.id] = history.moves;
        if (history?.savings) {
          const s = savingsByDay(history.savings, dayList);
          balances[h.id] = addBalances(balancesByDay(tradingPart(current, history.savings.fundNow, history.savings.earnNow), history.moves ?? [], dayList), s.balances);
          whole.add(h.id);
          for (const u of s.unexplained) found.push({ t: Date.parse(`${u.day}T12:00:00Z`), kind: u.amount < 0 ? "outflow" : "inflow", asset: u.coin, amount: Math.abs(u.amount), account: h.id });
        } else balances[h.id] = balancesByDay(current, history?.moves ?? [], dayList);
        if (history) {
          coverage[h.id] = history.coverage;
          activity.push(...history.activity);
          if (history.access.missing.length) access[h.id] = history.access;
        }
      }
      /* The closes of every asset held on any day. */
      const assets = [...new Set(Object.values(balances).flatMap((b) => Object.values(b).flatMap((held) => Object.entries(held).filter(([, v]) => v > 0).map(([a]) => a))))].filter((a) => !STABLES.has(a));
      const closes: Record<string, Candle[]> = {};
      await Promise.all(
        assets.map(async (asset) => {
          const r = await candles(`${asset}/USDT`, "1d", days + 1, { bytnodeKey: transport.bytnodeKey, accounts, signal });
          if ("candles" in r) closes[asset] = r.candles;
        }),
      );
      const values: Record<string, Record<string, number>> = {};
      const missing = new Set<string>();
      for (const [id, b] of Object.entries(balances)) {
        const v = valueByDay(b, closes);
        values[id] = v.values;
        v.missing.forEach((a) => missing.add(a));
      }
      /* The money in and out each day, to measure the performance net of it:
         an account read from its ledger alone takes its flows from the same
         ledger (the transfers that moved its curve); one rebuilt whole, or
         without a ledger, from its deposits, withdrawals and the outflows
         found. */
      for (const f of found) {
        const price = STABLES.has(f.asset) ? 1 : closeOn(closes[f.asset], new Date(f.t).toISOString().slice(0, 10));
        if (price !== undefined && f.amount * price >= 1) activity.push(f);
      }
      const flows = flowsByDay(activity.filter((a) => !ledgers[a.account] || whole.has(a.account)), closes);
      for (const [id, moves] of Object.entries(ledgers)) if (!whole.has(id)) flows[id] = flowsOfMoves(moves, closes);
      const points = dayList.map((date) => {
        const byAccount = Object.fromEntries(Object.keys(values).map((id) => [id, values[id][date] ?? 0]));
        const total = Object.values(byAccount).reduce((t, v) => t + v, 0);
        const dayFlows = Object.fromEntries(Object.keys(flows).flatMap((id) => (flows[id][date] ? [[id, flows[id][date]]] : [])));
        const flow = Object.values(dayFlows).reduce((t, v) => t + v, 0);
        return { date, at: `${date}T00:00:00.000Z`, totalUsd: Math.round(total * 100) / 100, assets: {}, accounts: byAccount, ...(flow ? { flowUsd: flow, flows: dayFlows } : {}), estimated: true as const };
      });
      return { points: holdings.length ? points : [], missing: [...missing], sources, coverage, activity: activity.sort((a, b) => b.t - a.t), access };
    };
    const backfills = new Warm<Awaited<ReturnType<typeof rebuild>>>(60 * MINUTE);
    const backfillOf = (holdings: Holdings, days: number, transport: Pick<Transport, "bytnodeKey" | "exchangeAccounts">) =>
      holdings.length ? backfills.get(`${accountsKey(transport.exchangeAccounts ?? [], transport.bytnodeKey ?? "")}|${days}|${holdingsKey(holdings)}`, () => rebuild(holdings, days, transport)) : rebuild(holdings, days, transport);

    /* The preload (user request): as soon as the set of accounts changes —
       one added, removed, its keys replaced — and once when the app opens,
       the accounts are read and the year of history rebuilt, in the
       background. The tab and the widget then open on them at once. Nothing
       otherwise: an unchanged set costs no exchange call and no BytNode
       quota. Checked every minute, while a tab is open. */
    let preloaded = "";
    ctx.job({
      id: "preload",
      title: "Portfolio preload",
      every: "every 1 minute",
      catchUp: "run-once-on-start",
      async run({ session }) {
        const accounts = session.exchangeAccounts;
        if (accounts.length === 0) {
          preloaded = "";
          return "No exchange account: nothing to preload.";
        }
        const key = accountsKey(accounts, session.bytnodeKey);
        if (key === preloaded) return "Already preloaded.";
        preloaded = key;
        const transport = { bytnodeKey: session.bytnodeKey, exchangeAccounts: accounts };
        try {
          const { summary } = await read(transport);
          await backfillOf(holdingsOf(summary), BACKFILL_DAYS, transport);
          return `Preloaded ${accounts.length} account${accounts.length > 1 ? "s" : ""} and their history.`;
        } catch (e) {
          /* Not retried every minute: the tab reads again when opened. */
          return `Preload incomplete: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    ctx.api("export", async (params, { transport }) => {
      const report = ctx.optional<ReportService>("report-export");
      if (!report) throw new Error("Report export is off: switch it on in Settings → Plugins.");
      const agentId = typeof params.agentId === "string" ? params.agentId : "";
      const workspace = await resolveWorkspace(agentId, typeof params.workspace === "string" ? params.workspace : "");
      const { summary, money, at } = await current(params.currency, transport);
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
