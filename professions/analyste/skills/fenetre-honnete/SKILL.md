---
name: fenetre-honnete
description: Open this before qualifying a trend — the mandatory multi-horizon table, why the window is fixed before the conclusion, and how to handle a disagreement between horizons
---

# The window is chosen before the conclusion, not after

On the same data, "BTC is rising strongly" and "BTC is in a downtrend" are both true — it is enough to look at 7 days or 6 months. Your bias: you form an impression, then you keep the horizon that confirms it. The user has no way to see it.

**Rule: the multi-horizon table is computed and displayed before you qualify anything.**

## The table

Always the same columns, in the same order, even when a horizon is inconvenient.

| Horizon | Change | Position in the channel |
|---|---:|---|
| 24h | … | |
| 7d | … | |
| 30d | … | |
| 90d | … | |
| 1y | … | |

```python
import pandas as pd
df = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time").sort_index()
c = df["close"]
for label, n in [("24 h", 1), ("7 j", 7), ("30 j", 30), ("90 j", 90), ("1 an", 365)]:
    if len(c) > n:
        print(f"{label:>5} : {100*(c.iloc[-1]/c.iloc[-1-n]-1):+7.2f} %")
print(f"position 1 an : {100*(c.iloc[-1]-c.tail(365).min())/(c.tail(365).max()-c.tail(365).min()):.0f} % du canal")
```

If the history is too short for a horizon, write it ("1y: insufficient history") — do not remove it from the row.

## When the horizons contradict each other

This is the most frequent case, and it is information, not a problem to solve. Name it:

> Up 6% over 7d **within** a fall of 18% over 90d: a rebound inside a downtrend. As long as the price stays below the MA200, the underlying reading remains bearish.

A trend is qualified over a **named** horizon: "bullish over 7 days", never "bullish" on its own.

## The starting point

A change depends as much on its starting point as on its end point. Two precautions:

- **Do not start the window from an extreme.** "+140% from the low" is true and misleading: the low was chosen after the fact. Also give the change from a fixed date (start of the year, one year ago).
- **Round dates are not neutral**: "since the start of the month" can cover three days. Display the actual duration.

## What replaces "strongly"

Adverbs are your escape hatch: "strongly", "clearly", "slightly" have no definition. Replace them with a quantified comparison: "+6% in 7d, i.e. 1.8 standard deviations of the weekly change over one year". See `taux-de-base`.

## Related

- `taux-de-base`: what to compare against to know whether it is "strong".
- `piege-de-la-narration`: not explaining a move that is noise.
