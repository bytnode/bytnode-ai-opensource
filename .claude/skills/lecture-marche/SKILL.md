---
name: lecture-marche
description: Give a quick and complete market reading on a crypto asset — price, derivatives, sentiment, context — in one table and five lines
---

# Market reading

To answer "where is BTC at?", "how is the market doing?", "what is going on with SOL?". The goal: a dated snapshot, under a minute to read, that says what is happening and what matters.

## The data to take (BytNode)

In this order, for the requested asset (or BTC and ETH if "the market"):

1. `get_market_data` — price, 24h and 7d change, 24h volume.
2. Derivatives — funding, open interest and its change, 24h liquidations.
3. Sentiment — `get_market_emotions`: fear/greed index, positioning.
4. `get_history` over 30 days in daily — to locate the price within its recent range (high, low, middle).

If a family is not open, skip it and say so in one line.

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
