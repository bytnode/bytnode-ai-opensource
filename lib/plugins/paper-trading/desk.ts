import { randomUUID } from "node:crypto";
import type { PluginStore } from "../core/store";
import type { PaperBook } from "./books";
import { isQuote, quote, quotes, type PriceSources } from "../shared/prices";
import { cancelOrders, checkBook, emptyBook, neededSymbols, placeOrder, valuation, type Book, type CheckEvent, type EngineConfig, type OrderInput, type PaperOrder, type Fill, type Valuation } from "./engine";

/* ---------------------------------------------------------------------------
   The paper trading desk: the engine on ONE stored portfolio (its file:
   `books.ts`), with live prices. The shelf holds the portfolios and hands
   out the desk of the one asked for.

   Every change goes through the store's lock — the tools of a subscription
   session run in another process. Each look at the market (a tool, the
   view, the background job) also fills the limits it reached and
   liquidates what it crossed, and says so (`onEvents`). SERVER-ONLY.
--------------------------------------------------------------------------- */

export const BOOK = "default.json";

export type DeskSettings = { capital: number; engine: EngineConfig };

export type Look = { book: Book; valuation: Valuation; events: CheckEvent[]; at: Date; priceErrors: string[]; prices: Map<string, number> };

export type Desk = {
  read(): Promise<Book>;
  place(input: OrderInput, sources: PriceSources): Promise<{ order: PaperOrder; fill?: Fill; price: number; source: string } | { error: string }>;
  cancel(id: string): Promise<{ cancelled: PaperOrder[] } | { error: string }>;
  reset(capital?: number): Promise<Book>;
  look(sources: PriceSources): Promise<Look>;
};

const newId = () => randomUUID().slice(0, 8);

/** A portfolio picked by name: its desk, and whether it has siblings (the
    answers then name it). */
export type Picked = { desk: Desk; book: PaperBook; many: boolean };

export type Shelf = {
  list(): Promise<PaperBook[]>;
  /** By id or name; none: the default (first) one. */
  pick(ref?: string | null): Promise<Picked | { error: string }>;
};

export function paperDesk(store: PluginStore, settings: () => DeskSettings, onEvents: (events: CheckEvent[]) => Promise<void>, file = BOOK): Desk {
  const fresh = () => emptyBook(settings().capital, new Date());
  const read = () => store.read<Book>(file, fresh());

  return {
    read,

    async place(input, sources) {
      const q = await quote(input.symbol, sources);
      if (!isQuote(q)) return { error: q.error };
      let result = { error: "" } as { order: PaperOrder; fill?: Fill } | { error: string };
      await store.update<Book>(file, fresh(), (book) => {
        const r = placeOrder(book, input, q.price, settings().engine, newId, new Date());
        result = r;
        return "error" in r ? book : r.book;
      });
      return "error" in result ? result : { ...result, price: q.price, source: `${q.source} ${q.at.slice(11, 16)} UTC` };
    },

    async cancel(id) {
      let result = { error: "" } as { cancelled: PaperOrder[] } | { error: string };
      await store.update<Book>(file, fresh(), (book) => {
        const r = cancelOrders(book, id, new Date());
        result = r;
        return "error" in r ? book : r.book;
      });
      return result;
    },

    async reset(capital) {
      const book = emptyBook(capital ?? settings().capital, new Date());
      await store.write(file, book);
      return book;
    },

    async look(sources) {
      const seen = await read();
      const priced = await quotes(neededSymbols(seen), sources);
      const prices = new Map<string, number>();
      const priceErrors: string[] = [];
      for (const [symbol, p] of priced) {
        if (isQuote(p)) prices.set(symbol, p.price);
        else priceErrors.push(p.error);
      }
      const at = new Date();
      let events: CheckEvent[] = [];
      /* Written only when the market changed something. */
      const book = checkBook(seen, prices, settings().engine, newId, at).events.length
        ? await store.update<Book>(file, fresh(), (current) => {
            const r = checkBook(current, prices, settings().engine, newId, at);
            events = r.events;
            return r.book;
          })
        : seen;
      if (events.length) await onEvents(events);
      return { book, valuation: valuation(book, prices, settings().engine), events, at, priceErrors, prices };
    },
  };
}
