import { resolveWorkspace } from "@/lib/server/workspace";
import { definePlugin } from "../core/contract";
import type { ReportService } from "../report-export/service";
import type { SchedulerService } from "../scheduler/service";
import { normalizeSymbol } from "../shared/quote";
import { paperDesk, type DeskSettings } from "./desk";
import { CASH, type CheckEvent, type OrderType, type PaperMarket, type Side } from "./engine";
import { paperTradingManifest } from "./manifest";
import { paperCancelTool } from "./paper-cancel";
import { paperOrderTool } from "./paper-order";
import { paperPortfolioTool } from "./paper-portfolio";
import { paperResetTool } from "./paper-reset";
import { SIMULATED, exportSections, fillLine, orderLine, paperPrompt } from "./present";
import type { PaperService } from "./service";

/* Paper trading: the simulated portfolio, its four tools, its prompt
   section, the service the DCA buys through, a job that watches the open
   limits and the positions every minute (when the scheduler runs), and
   the view's actions. */

/** Maintenance margin of the simulated futures: a typical first tier. */
const MMR = 0.005;

const NOTICE: Record<CheckEvent["kind"], { title: string; level: "success" | "warning" | "error" }> = {
  filled: { title: "Paper order filled", level: "success" },
  cancelled: { title: "Paper order cancelled", level: "warning" },
  liquidated: { title: "Paper position liquidated", level: "error" },
};

export const paperTradingPlugin = definePlugin({
  manifest: paperTradingManifest,
  setup(ctx) {
    const settings = (): DeskSettings => {
      const c = ctx.config();
      return { capital: Number(c.capital), engine: { feeRate: Number(c.feePercent) / 100, slippage: Number(c.slippagePercent) / 100, mmr: MMR } };
    };
    const desk = paperDesk(ctx.store, settings, async (events) => {
      for (const e of events) {
        const body = e.kind === "cancelled" ? `${orderLine(e.order)}: ${e.reason}` : fillLine(e.fill);
        await ctx.notify({ ...NOTICE[e.kind], body, action: { kind: "open-view", view: "paper-trading" } });
        ctx.emit(e.kind, e);
      }
    });

    ctx.tool(paperOrderTool(desk));
    ctx.tool(paperCancelTool(desk));
    ctx.tool(paperPortfolioTool(desk));
    ctx.tool(paperResetTool(desk));
    ctx.prompt(async () => paperPrompt(await desk.read()));
    ctx.provide<PaperService>(() => ({
      cash: CASH,
      buy: ({ symbol, quoteAmount, note }, sources) => desk.place({ symbol, market: "spot", side: "buy", type: "market", quoteAmount, note }, sources),
    }));

    ctx.optional<SchedulerService>("scheduler")?.job({
      id: "orders",
      title: "Paper orders",
      every: "every 1 minute",
      async run({ session, signal }) {
        const book = await desk.read();
        if (!book.orders.some((o) => o.status === "open") && book.positions.length === 0) return "Nothing to watch.";
        const look = await desk.look({ bytnodeKey: session.bytnodeKey, accounts: session.exchangeAccounts, signal });
        if (look.priceErrors.length) throw new Error(look.priceErrors.join(" "));
        return look.events.length ? look.events.map((e) => e.kind).join(", ") : "No limit reached, no liquidation.";
      },
    });

    /* --- The view ---------------------------------------------------------- */

    ctx.api("state", async (_params, { transport, signal }) => {
      const look = await desk.look({ bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal });
      const s = settings();
      return {
        valuation: look.valuation,
        capital: look.book.capital,
        createdAt: look.book.createdAt,
        orders: look.book.orders.filter((o) => o.status === "open"),
        fills: look.book.fills.slice(-100).reverse(),
        at: look.at.toISOString(),
        priceErrors: look.priceErrors,
        feePercent: s.engine.feeRate * 100,
        slippagePercent: s.engine.slippage * 100,
      };
    });
    ctx.api("order", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) throw new Error("Give a pair, e.g. BTC/USDT.");
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const r = await desk.place(
        {
          symbol,
          market: params.market === "futures" ? "futures" : ("spot" as PaperMarket),
          side: params.side === "sell" ? "sell" : ("buy" as Side),
          type: params.type === "limit" ? "limit" : ("market" as OrderType),
          amount: num(params.amount),
          quoteAmount: num(params.quoteAmount),
          price: num(params.price),
          leverage: num(params.leverage),
          reduceOnly: params.reduceOnly === true || undefined,
        },
        { bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal },
      );
      if ("error" in r) throw new Error(r.error);
      return r;
    });
    ctx.api("cancel", async (params) => {
      const r = await desk.cancel(String(params.orderId ?? ""));
      if ("error" in r) throw new Error(r.error);
      return r;
    });
    ctx.api("reset", async (params) => desk.reset(typeof params.capital === "number" ? params.capital : undefined));
    ctx.api("export", async (params, { transport, signal }) => {
      const report = ctx.optional<ReportService>("report-export");
      if (!report) throw new Error("Report export is off: switch it on in Settings → Plugins.");
      const agentId = typeof params.agentId === "string" ? params.agentId : "";
      const workspace = await resolveWorkspace(agentId, typeof params.workspace === "string" ? params.workspace : "");
      const look = await desk.look({ bytnodeKey: transport.bytnodeKey, accounts: transport.exchangeAccounts, signal });
      const date = `${look.at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
      const s = settings();
      const written = await report.write({
        workspace,
        scope: "workspace",
        title: `Paper portfolio — ${look.at.toISOString().slice(0, 10)}`,
        summary: SIMULATED,
        sections: exportSections(look.book, look.valuation),
        sources: [
          { name: "Simulated portfolio of BytNode-AI (paper trading)", date },
          { name: `Valuation: BytNode prices, exchange tickers where BytNode has none; fees ${s.engine.feeRate * 100} %, slippage ${s.engine.slippage * 100} %`, date },
        ],
        author: "BytNode-AI · Paper trading",
      });
      return { path: written.rel, agentId, workspace };
    });
  },
});
