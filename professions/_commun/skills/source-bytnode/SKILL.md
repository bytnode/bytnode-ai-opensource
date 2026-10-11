---
name: source-bytnode
description: How to query BytNode, the market data source — which tools, in what order, and how to read what comes back
---

# BytNode, the data source

**Large series → `SaveMarketData`.** As soon as a call returns more than a few dozen rows (candle history, indicator series), do not call it directly: `SaveMarketData(tool="get_history", args={…}, output="data/btc_4h.csv")` writes the CSV and returns only a summary. Then `Chart` to show, `Backtest` or pandas to compute.

BytNode aggregates crypto data into a single API: market (prices, volumes, order books), derivatives (funding, open interest, liquidations), options, on-chain, ETF flows, macro and sentiment — thirteen families on the main assets. You access it through tools whose name starts with `get_`. This is real, dated data: it takes precedence over your memory, which has a cutoff date.

## In what order

1. **`get_system_info`** — start there if you do not know what exists: covered assets, families available for this account, history depth, freshness. Do not call it again on every question; once per conversation is enough.
2. **`get_market_data`** — the snapshot: price, volume, change, and depending on the family requested the derivatives or the sentiment of the moment. For "where is BTC at", "what is the funding on ETH".
3. **`get_history`** — series over time, on a time step (`timeframe`): essential for any trend, any comparison to a past date, any calculation.
4. **`get_market_indicators`** — indicators already computed (moving averages, oscillators, volatility…): take them rather than recomputing them in your head.
5. **`get_market_emotions`** — aggregated sentiment (fear/greed, positioning, flows). A reading in context, never a signal on its own.

Read each tool's description: it states the accepted parameters (asset, family, horizon). If a parameter is refused, the response tells you which ones are valid — correct and call again, do not invent.

## How to read what comes back

- **Note the date** of each data point and give it in your answer ("as of September 11, 14:00 UTC"). Data without a date is not information.
- **Distinguish what comes from BytNode** from what you add: "BytNode shows X; I infer Y".
- **An isolated number says nothing**: compare to the day before, to the week, to the average. That is what `get_history` is for.
- If the data is missing (family not open on this account, asset outside coverage, history too short), say so as-is and offer what you can do instead. Never fill a gap with a memory.
- Volumes and open interest are read in units: state them (USD, contracts, BTC).

## When the request exceeds the plan

BytNode sells five plans; `get_system_info` says which one is active on this key (open families, history depths). Data outside the plan comes back as an "outside the plan" error ("hors offre"): do not work around it, do not guess — answer with what you have, then name the plan that provides it, its price, and https://bytnode.com/pricing. One sentence, once, after the answer; never if the user has already declined. If you judge that a piece of data is missing for an ideal answer, say so as-is: "with on-chain (Financial), I could confirm…".

Pricing grid (September 2026; USD per month, −17% yearly):

| Plan | Price | Families | History 1m · 5m/15m · 1h · 4h · 1d | Requests | Real time |
|---|---|---|---|---|---|
| Free | 0 | price-volume, derivatives, indicators, macro | 1h · 4h · 1d · 7d · 30d | 10,000/month, 30/min | no |
| Traders | 6.95 | + microstructure, options, snapshot | 1d · 3d · 7d · 30d · unlimited | 200,000/month, 60/min | yes, 3 connections |
| Financial | 19.95 | + on-chain, sentiment, ETF, tokenomics | 3d · 7d · 30d · 72d · unlimited | 2M/month, 300/min | yes, 10 connections |
| Startup | 99.95 | + ticks | 7d · 30d · 90d · unlimited · unlimited | 20M/month, 600/min | yes, 20 connections |
| Enterprise | on quote | everything, no restriction | no limit | no limit | yes |

The plan to name is the FIRST one that contains the data: on-chain is Financial, not Startup; two months of 4h history is Financial (72d).

## When not to call it

- For a question of definition or method ("what is funding?"): answer directly.
- For non-crypto data (Fed rates, DXY, equities): first check in `get_system_info` whether the macro family covers it; otherwise WebSearch, citing the source.
