---
name: hypothese-de-regime
description: Open this when designing a strategy — name the market regime in which it is supposed to win, write the filter that detects it, and measure its performance regime by regime
---

# A strategy wins in a regime, not "in general"

No rule wins everywhere: trend following loses in a range, mean reversion gets swept away in a trend, volatility selling wins ninety times then gives everything back. Your flaw is to propose strategies **without naming their regime**, hence without a filter to avoid it and without knowing when they are going to fail.

**Rule: the strategy declares its regime, the filter that detects it, and its performance measured in each regime — not only on average.**

## Regimes, defined in advance

Define them **before** looking at the results, with causal rules (data ≤ t).

```python
import pandas as pd
df = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time").sort_index()
c = df["close"]
mm200 = c.rolling(200).mean()
pente = mm200.pct_change(20)                                  # slope over 20d
atr = (df["high"] - df["low"]).rolling(14).mean() / c         # relative volatility

regime = pd.Series("range", index=c.index)
regime[(c > mm200) & (pente > 0.01)] = "haussier"
regime[(c < mm200) & (pente < -0.01)] = "baissier"
df["vol"] = pd.cut(atr, [0, 0.02, 0.05, 1], labels=["calme", "normale", "extreme"])
print(pd.crosstab(regime, df["vol"], normalize="all").round(3))
```

Four families are enough: **bullish**, **bearish**, **range**, and across them **calm / normal / extreme volatility**.

## The table that must accompany every backtest

| Regime | Share of time | Return | Sharpe | Max DD | Trades |
|---|---:|---:|---:|---:|---:|
| bullish | 38% | … | … | … | … |
| bearish | 24% | … | … | … | … |
| range | 38% | … | … | … | … |
| extreme vol. | 9% | … | … | … | … |

Its reading:

- **Wins everywhere**: suspicion. Look for the data leak (`anti-fuite`) before rejoicing.
- **Wins in one regime, neutral elsewhere**: that is the good case — the regime filter becomes a rule of the strategy.
- **Wins in one regime, loses heavily in another**: the strategy is only validated if the filter detects the regime **in real time**, without knowing what comes next.
- **The winning regime represents 10% of the time**: the strategy is rare. Say how many trades per year that leaves, and whether the sample allows a conclusion.

## The trap of the retrospective filter

A regime filter that uses the future is not a filter: it is cheating. "Only trade in bullish phases" is valid if the phase is detected with `close > MA200` at instant t; it is wrong if the phase is named after the fact by looking at the chart.

Check it: the filter must be computed inside `signal(df)` like the rest, without `shift(-1)`, without `center=True`.

## Regime change is expensive

Transitions are where strategies lose: trend following gives its worst trades at the reversal. Two consequences to write down:

- The **filter's lag**: an MA200 turns with several weeks of delay. Say so, and measure the cost of this lag (performance of the 10 candles following each flip).
- The **extreme volatility guardrail**: reduce size or do not trade when `ATR/close` exceeds its 90th percentile. It is often the most profitable addition to the whole strategy — and it only costs one parameter.

## What to write in the proposal

> **Regime hypothesis**: trend following, wins in a directional market (prolonged bullish or bearish), loses in a range. Detection: `close` on the side of the MA200 and MA200 slope over 20d beyond ±1%. Over 2022-2026, the directional regime covers 62% of the time. Outside the regime, the strategy takes no position. Guardrail: no entry if ATR14/close > 6% (9% of the time). Cost of the detection lag: the 10 candles following a flip are negative on average by −0.4%.

## Related

- `specification-executable`: the regime filter is a mandatory field.
- `budget-de-parametres`: the filter must not become a pretext for tuning.
- `validation-statistique` (Quantitative profession): measuring by regime is part of the protocol.
