/* The paper portfolios' cash currency: paper pairs are quoted in it. Here
   and not in the paper trading's code, so the DCA can check a paper plan
   whether the paper trading runs or not (plugins never import each
   other's code). */
export const PAPER_CASH = "USDT";
