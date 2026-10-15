---
name: lecture-marche
description: Give a quick and complete market reading on a crypto asset — price, derivatives, sentiment, context — in one table and five lines
---

# Market reading

To answer "where is BTC at?", "how is the market doing?", "what is going on with SOL?". The goal: a dated snapshot, under a minute to read, that says what is happening and what matters.

## The data to take (BytNode)

`get_market_data` on the requested asset (`symbol=BTCUSDT`, or BTC and ETH if "the market"). A call has one `timeframe`, so two calls per asset:

1. With `timeframe=1d`: `price_change` (price, rolling 1d and 1w changes), `klines=30` (the last 30 daily candles — to locate the price within its recent range and compare the last day's volume to the average), `funding_next` (estimated funding, % per 8h), `oi=8` (open interest and its change over a week), `fear_greed` (market-wide sentiment).
2. With `timeframe=1h`: `liquidations_cumulative=24` (longs vs shorts liquidated, USD per hour, over 24h).

If a field is outside the plan (`out_of_plan_fields`, or a 403 that names it), skip it and say so in one line.

## The reading

Answer with a table then five lines at most:

| | Value | Reading |
|---|---|---|
| Price | $63,200 (+2.1% / 24h) | in the upper third of the 30d range |
| 24h volume | … | above / below the average |
| Funding | … | positive = longs pay, market leaning long |
| Open interest | … | rising with price = trend fuelled; rising against price = fragility |
| 24h liquidations | … | longs or shorts? |
| Sentiment | … | fear / neutral / greed |

Then:
- **The dominant fact**: what explains the day's move (a flow, a macro release, a liquidation cascade) — if it is identifiable; otherwise, say that nothing stands out.
- **The regime**: trend (in which direction, since when), range, or transition.
- **Points of attention**: range levels, extreme funding, divergent OI, sentiment at an extreme.
- **What is missing** to settle it, if something is missing.

## Rules

- Every number carries its date/time (UTC) and comes from BytNode.
- "Bullish" or "bearish" is always said with a horizon.
- No price target. Range levels, yes: those are facts.
