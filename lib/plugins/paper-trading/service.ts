import type { PriceSources } from "../shared/prices";
import type { Fill, PaperOrder } from "./engine";

/* What the paper trading offers the plugins that use it (the DCA): a
   simulated purchase, at the market, in the paper portfolio. */
export type PaperService = {
  buy(input: { symbol: string; quoteAmount: number; note: string }, sources: PriceSources): Promise<{ order: PaperOrder; fill?: Fill; price: number } | { error: string }>;
};
