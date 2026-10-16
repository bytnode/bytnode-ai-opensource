import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolveWorkspace } from "@/lib/server/workspace";
import { definePlugin } from "../core/contract";
import type { ReportService } from "../report-export/service";
import type { PriceSources } from "../shared/prices";
import { bytnodePairs, candles, quote } from "../shared/prices";
import { isInterval } from "../shared/candle";
import { normalizeSymbol } from "../shared/quote";
import { INDEX, addBook, bookFile, findBook, listOrDefault, removeBook, renameBook, type PaperBook } from "./books";
import { resultCurve } from "./curve";
import { tradeStats } from "./stats";
import { paperDesk, type Desk, type DeskSettings, type Picked, type Shelf } from "./desk";
import { CASH, available, emptyBook, type CheckEvent, type OrderType, type PaperMarket, type Side } from "./engine";
import { paperTradingManifest } from "./manifest";
import { paperCancelTool } from "./paper-cancel";
import { paperOrderTool } from "./paper-order";
import { paperPortfolioTool } from "./paper-portfolio";
import { paperResetTool } from "./paper-reset";
import { SIMULATED, exportSections, fillLine, orderLine, paperPrompt } from "./present";
import type { PaperService } from "./service";
import { APP_PASS } from "@/lib/bytnode/pass-id";

/* Paper trading: the simulated portfolios (`books.ts` — several, each with
   its name, the first the default), their four tools, the prompt section,
   the service the DCA buys through (into the default portfolio), a job
   on the core's clock that watches every portfolio's open limits and
   positions every minute, and the view's actions, each on the
   portfolio it names. */

const CAPITAL_RANGE = "A starting capital between 100 and 10 000 000 USDT.";

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

    const list = async (): Promise<PaperBook[]> => listOrDefault(await ctx.store.read<PaperBook[] | null>(INDEX, null), new Date());
    /** The list changes: the historic book is written into it first. */
    const change = (fn: (books: PaperBook[]) => PaperBook[] | { error: string }) => {
      let error: string | null = null;
      return ctx.store
        .update<PaperBook[] | null>(INDEX, null, (stored) => {
          const r = fn(listOrDefault(stored, new Date()));
          if ("error" in r) {
            error = r.error;
            return stored;
          }
          return r;
        })
        .then((books) => {
          if (error) throw new Error(error);
          return books ?? [];
        });
    };
    const deskOf = (book: PaperBook, many: boolean): Desk =>
      paperDesk(
        ctx.store,
        settings,
        async (events) => {
          for (const e of events) {
            const body = e.kind === "cancelled" ? `${orderLine(e.order)}: ${e.reason}` : fillLine(e.fill);
            await ctx.notify({ ...NOTICE[e.kind], body: many ? `${book.name} — ${body}` : body, action: { kind: "open-view", view: "paper-trading", params: { portfolio: book.id } } });
            ctx.emit(e.kind, { ...e, portfolio: book.id });
          }
        },
        bookFile(book.id),
      );
    const shelf: Shelf = {
      list,
      async pick(ref) {
        const books = await list();
        const book = findBook(books, ref);
        if ("error" in book) return book;
        return { book, desk: deskOf(book, books.length > 1), many: books.length > 1 };
      },
    };
    /** The view's portfolio: the one it names, else the default. */
    const picked = async (params: Record<string, unknown>): Promise<Picked> => {
      const p = await shelf.pick(typeof params.portfolio === "string" ? params.portfolio : null);
      if ("error" in p) throw new Error(p.error);
      return p;
    };
    const sourcesOf = (transport: { bytnodeKey: string; exchangeAccounts: PriceSources["accounts"] }, signal: AbortSignal): PriceSources => ({ bytnodeKey: APP_PASS, accounts: transport.exchangeAccounts, signal });

    ctx.tool(paperOrderTool(shelf));
    ctx.tool(paperCancelTool(shelf));
    ctx.tool(paperPortfolioTool(shelf));
    ctx.tool(paperResetTool(shelf));
    ctx.prompt(async () => {
      const books = await list();
      return paperPrompt(
        await Promise.all(
          books.map(async (b) => {
            const book = await deskOf(b, books.length > 1).read();
            return { name: b.name, book, free: available(book, CASH, settings().engine) };
          }),
        ),
      );
    });
    ctx.provide<PaperService>(() => ({
      cash: CASH,
      buy: async ({ symbol, quoteAmount, note }, sources) => {
        const p = await shelf.pick(null);
        if ("error" in p) return p;
        return p.desk.place({ symbol, market: "spot", side: "buy", type: "market", quoteAmount, note }, sources);
      },
    }));

    ctx.job({
      id: "orders",
      title: "Paper orders",
      every: "every 1 minute",
      async run({ session, signal }) {
        const books = await list();
        const said: string[] = [];
        const errors: string[] = [];
        for (const b of books) {
          const desk = deskOf(b, books.length > 1);
          const book = await desk.read();
          if (!book.orders.some((o) => o.status === "open") && book.positions.length === 0) continue;
          const look = await desk.look({ bytnodeKey: APP_PASS, accounts: session.exchangeAccounts, signal });
          errors.push(...look.priceErrors);
          if (look.events.length) said.push(`${b.name}: ${look.events.map((e) => e.kind).join(", ")}`);
        }
        if (errors.length) throw new Error([...new Set(errors)].join(" "));
        return said.length ? said.join("; ") : "No limit reached, no liquidation.";
      },
    });

    /* --- The view ---------------------------------------------------------- */

    /* Every portfolio, valued: the view's left column. */
    ctx.api("books", async (_params, { transport, signal }) => {
      const books = await list();
      return Promise.all(
        books.map(async (b) => {
          const look = await deskOf(b, books.length > 1).look(sourcesOf(transport, signal));
          const v = look.valuation;
          return { id: b.id, name: b.name, createdAt: look.book.createdAt, capital: look.book.capital, equity: v.equity, returnPct: v.returnPct, positions: v.positions.length, orders: look.book.orders.filter((o) => o.status === "open").length };
        }),
      );
    });
    ctx.api("create", async (params) => {
      const capital = typeof params.capital === "number" && Number.isFinite(params.capital) ? params.capital : settings().capital;
      if (capital < 100 || capital > 10_000_000) throw new Error(CAPITAL_RANGE);
      const id = randomUUID().replace(/-/g, "").slice(0, 8);
      const books = await change((current) => addBook(current, String(params.name ?? ""), id, new Date()));
      const made = books.find((b) => b.id === id)!;
      await ctx.store.write(bookFile(id), emptyBook(capital, new Date()));
      return made;
    });
    ctx.api("rename", async (params) => {
      const { book } = await picked(params);
      return (await change((current) => renameBook(current, book.id, String(params.name ?? "")))).find((b) => b.id === book.id);
    });
    ctx.api("delete", async (params) => {
      const { book } = await picked(params);
      await change((current) => removeBook(current, book.id));
      await fs.rm(ctx.store.file(bookFile(book.id)), { force: true });
      return { deleted: book.id };
    });
    ctx.api("state", async (params, { transport, signal }) => {
      const { book: meta, desk } = await picked(params);
      const look = await desk.look(sourcesOf(transport, signal));
      const s = settings();
      const assets = [CASH, ...Object.keys(look.book.balances).filter((a) => a !== CASH)];
      const curve = resultCurve(look.book, look.at, look.valuation.equity);
      return {
        id: meta.id,
        name: meta.name,
        valuation: look.valuation,
        capital: look.book.capital,
        createdAt: look.book.createdAt,
        orders: look.book.orders.filter((o) => o.status === "open"),
        fills: look.book.fills.slice(-100).reverse(),
        /* What the open orders do not hold back: what a new order may use. */
        available: Object.fromEntries(assets.map((a) => [a, available(look.book, a, s.engine)])),
        /* The market, for the open orders' distance to their price. */
        prices: Object.fromEntries(look.prices),
        curve,
        stats: tradeStats(look.book.fills, curve),
        at: look.at.toISOString(),
        priceErrors: look.priceErrors,
        feePercent: s.engine.feeRate * 100,
        slippagePercent: s.engine.slippage * 100,
      };
    });
    /* What the ticket offers: every pair BytNode covers that the paper
       portfolios can trade — quoted in USDT. One cached BytNode call. */
    ctx.api("pairs", async (_params, { signal }) => (await bytnodePairs(APP_PASS, signal)).filter((p) => p.symbol.endsWith(`/${CASH}`)));
    /* The market chart of the pair in the ticket. */
    ctx.api("candles", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      const interval = isInterval(params.interval) ? params.interval : "1h";
      if (!symbol) return { symbol: "", interval, error: "Choose a pair." };
      const limit = typeof params.limit === "number" ? params.limit : 200;
      return candles(symbol, interval, limit, sourcesOf(transport, signal));
    });
    /* The order ticket's price: one pair, as the order would fill on it. */
    ctx.api("quote", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) return { symbol: "", error: "Give a pair, e.g. BTC/USDT." };
      if (symbol.split("/")[1] !== CASH) return { symbol, error: `The paper portfolio trades against ${CASH}: use ${symbol.split("/")[0]}/${CASH}.` };
      return quote(symbol, sourcesOf(transport, signal));
    });
    ctx.api("order", async (params, { transport, signal }) => {
      const symbol = normalizeSymbol(String(params.symbol ?? ""));
      if (!symbol) throw new Error("Give a pair, e.g. BTC/USDT.");
      const { desk } = await picked(params);
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
        sourcesOf(transport, signal),
      );
      if ("error" in r) throw new Error(r.error);
      return r;
    });
    ctx.api("cancel", async (params) => {
      const { desk } = await picked(params);
      const r = await desk.cancel(String(params.orderId ?? ""));
      if ("error" in r) throw new Error(r.error);
      return r;
    });
    /* Checked like `create`; no capital: the portfolio's own starting one
       (what the view's dialog says), not the plugin's default. */
    ctx.api("reset", async (params) => {
      const { desk } = await picked(params);
      const capital = params.capital === undefined || params.capital === null ? (await desk.read()).capital : params.capital;
      if (typeof capital !== "number" || !Number.isFinite(capital) || capital < 100 || capital > 10_000_000) throw new Error(CAPITAL_RANGE);
      return desk.reset(capital);
    });
    ctx.api("export", async (params, { transport, signal }) => {
      const report = ctx.optional<ReportService>("report-export");
      if (!report) throw new Error("Report export is off: switch it on in Settings → Plugins.");
      const { book: meta, desk, many } = await picked(params);
      const agentId = typeof params.agentId === "string" ? params.agentId : "";
      const workspace = await resolveWorkspace(agentId, typeof params.workspace === "string" ? params.workspace : "");
      const look = await desk.look(sourcesOf(transport, signal));
      const date = `${look.at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
      const s = settings();
      const written = await report.write({
        workspace,
        scope: "workspace",
        title: `${many ? `Paper portfolio "${meta.name}"` : "Paper portfolio"} — ${look.at.toISOString().slice(0, 10)}`,
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
