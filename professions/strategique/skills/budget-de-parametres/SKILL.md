---
name: budget-de-parametres
description: Open this when a strategy accumulates conditions — how to count parameters, the ceiling to respect, and the procedure for removing a rule rather than adding one
---

# Every added condition is a chance to be wrong

Your reflex, when a strategy gives a mediocre result, is to **add**: an RSI filter, a volume condition, a time-of-day threshold, a weekend exception. The backtest improves with each addition — that is precisely the symptom. You are not improving the strategy, you are moulding it onto the past.

**Rule: four parameters at most. Each one is justified by a market reason, not by its effect on the result.**

## What counts as a parameter

Any number you could change: moving average lengths, indicator thresholds, stop multipliers, maximum position duration, hours of the day, volatility caps.

```
close > MA200          →  1 parameter (200)
MA20 > MA50            →  2 (20, 50)
RSI(14) < 30           →  2 (14, 30)
stop 2 × ATR(14)       →  2 (2, 14)
volume > 1.5 × MA20    →  2 (1.5, 20)
                          ─────────────
                          9 parameters → refused
```

Do not count: the timeframe, the universe, the risk per trade (fixed by the framework, not optimised).

## The ceiling, and why

With `k` parameters tried over `T` years of data, the best Sharpe found is inflated by roughly `sqrt(2 ln K / T)` where `K` is the number of combinations explored. Three parameters with ten values each: K = 1,000, i.e. over 3 years an inflation of ~+1.5 of Sharpe **on pure noise**. That is more than the edge of most real strategies.

| Parameters | What it requires |
|---|---|
| 1 to 2 | ideal — honestly testable |
| 3 to 4 | acceptable, each justified in writing |
| 5 and more | refused: start by removing |

## The procedure when the result disappoints

In this order, never the reverse:

1. **Remove** the least justified condition and retest. If the result barely moves, it was useless: it stays out.
2. **Check the costs** (`budget-de-cout`): the problem is often there, not in the signal.
3. **Change the timeframe or the universe** — that is a change of hypothesis, not an extra parameter.
4. **Give up.** A strategy without an edge does not acquire one by piling up filters. Abandoning it is a result, not a failure.

## The plateau test

An acceptable parameter has a **plateau**: neighbouring values give neighbouring results. An isolated peak is noise.

```
Backtest(..., params={"slow": 40})   # then 32, 36, 44, 48
```

Keep a value **in the middle of the plateau**, not at the peak. If no plateau appears, the parameter is meaningless: remove the rule.

## What to write in the proposal

> **Parameters**: 3 — MA200 (regime: long trend filter, standard value, plateau 150-250), MA20/MA50 (crossover: plateau 15-25 / 40-60), 2×ATR14 (stop: plateau 1.5-2.5). Variants explored: K ≈ 60. No volume or time-of-day filter: tested, no effect beyond noise, removed.

Declaring K honestly is what allows `validation-statistique` to deflate the Sharpe. Not declaring it is hiding it.

## Related

- `specification-executable`: where the parameters are declared.
- `validation-statistique` (Quantitative profession): the correction for multiple testing.
- `hypothese-de-regime`: a regime filter is a hypothesis, not a tuning parameter.
