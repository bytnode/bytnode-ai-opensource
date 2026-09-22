---
name: statistiques-des-series
description: Open this before asserting that a result is significant — why classical tests lie on financial returns, and what to use instead (block bootstrap, non-overlapping windows, intervals)
---

# Classical tests lie on returns

You apply the recipes from statistics courses: t-test, p-value, normal confidence interval. These recipes assume independent, identically distributed observations with stable variance. Financial returns satisfy none of the three. Result: an announced significance that does not exist.

## The four violated assumptions

| Assumption | Market reality | Consequence |
|---|---|---|
| Independence | volatility clustered in bunches (a turbulent day follows a turbulent day) | underestimated standard error → too-good p-value |
| Normality | fat tails, high kurtosis | "impossible" events happen several times a year |
| Constant variance | volatility regimes | a Sharpe stable on average hides two opposite regimes |
| Distinct observations | overlapping rolling windows | `n` is far smaller than the number of rows |

## What we use instead

### Block bootstrap

Resampling row by row destroys the autocorrelation, hence underestimates the uncertainty. By blocks, it is preserved.

```python
import numpy as np, pandas as pd

def bootstrap_blocs(net: pd.Series, ppy: int, taille_bloc: int = 20, n: int = 5_000, seed: int = 0):
    r = net.dropna().to_numpy()
    rng = np.random.default_rng(seed)
    nb = len(r) // taille_bloc
    sharpes = np.empty(n)
    for i in range(n):
        deb = rng.integers(0, len(r) - taille_bloc, nb)
        ech = np.concatenate([r[d : d + taille_bloc] for d in deb])
        sd = ech.std(ddof=1)
        sharpes[i] = (ech.mean() * ppy) / (sd * np.sqrt(ppy)) if sd else np.nan
    q = np.nanquantile(sharpes, [0.05, 0.5, 0.95])
    print(f"Sharpe médian {q[1]:.2f} — intervalle 90 % [{q[0]:.2f} ; {q[2]:.2f}]")
    return q
```

**Reading**: if the interval contains 0, there is no evidence of an edge. That is the sentence that replaces "p < 0.05".

### Non-overlapping windows

To compare periods, split without overlap. Thirty-six rolling 90-day windows over one year are not 36 observations: it is about 4.

```python
n_effectif = len(serie) // fenetre          # and not len(serie) - fenetre + 1
```

### The number of trades, not of candles

The statistics of a strategy bear on its **trades**. A backtest of 8,000 candles with 22 trades has a sample of 22.

| Trades | What can be said |
|---|---|
| < 20 | nothing. Describe the trades one by one |
| 20 to 50 | "indicative", very wide intervals |
| 50 to 200 | usable with bootstrap and intervals |
| > 200 | solid, if the trades are independent |

### The standard error of a Sharpe

Useful order of magnitude: `SE(Sharpe) ≈ sqrt((1 + SR²/2) / n_equivalent_years)`. Over 3 years, the standard error is around 0.6: a Sharpe measured at 1.0 is compatible with a true Sharpe of 0.4 as much as 1.6. Give the interval, not the point.

## What a p-value does not say

It gives the probability of observing this data **if the strategy had no edge**. It does not give the probability that the strategy works. And it loses all meaning if you tried twenty variants: see multiple testing in `validation-statistique`.

## The three check lines

Before any assertion of significance:

```python
r = net.dropna()
print(f"n = {len(r)} — autocorrélation(1) = {r.autocorr(1):.3f} — kurtosis = {r.kurt():.1f}")
print(f"écart-type 1ʳᵉ moitié {r[:len(r)//2].std():.5f} vs 2ᵈᵉ {r[len(r)//2:].std():.5f}")
```

A notable autocorrelation, a high kurtosis or two standard deviations that differ by a factor of two: parametric tests are out, switch to the bootstrap.

## The honest wording

> Sharpe 1.08 over 4.2 years (74 trades). Block bootstrap of 20: 90% interval [0.21; 1.86]. Order-1 autocorrelation: 0.04; kurtosis 6.3; volatility twice as high in the second half. Conclusion: edge **plausible but not established** — the interval brushes zero and the trade sample is modest.

## Related

- `validation-statistique`: the complete protocol (out-of-sample, multiple testing, deflation).
- `definitions-metriques`: how each metric is defined.
- `taux-de-base` (Analyst profession): the same caution, on the analysis side.
