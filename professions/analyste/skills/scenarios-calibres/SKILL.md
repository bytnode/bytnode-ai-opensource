---
name: scenarios-calibres
description: Open this to conclude an analysis — how to write scenarios with probabilities that sum to 1, observable thresholds, and an invalidation signal per scenario
---

# Three scenarios, probabilities, thresholds

Your typical conclusion is a gradient of caution: "probably", "it is possible that", "risks remain skewed to the downside". Nobody can act on that, and nobody can contradict you — that is the problem: an unfalsifiable analysis has no value.

**Rule: the conclusion takes the form of quantified, mutually exclusive scenarios whose probabilities sum to 1.**

## The template

| Scenario | Probability | Observable condition | Invalidated if | Horizon |
|---|---:|---|---|---|
| Bearish continuation | 45% | 1d close < 103,000 | close > 111,500 | 3 weeks |
| Consolidation | 35% | stays between 103,000 and 111,500 | exit from the channel, volume > MA20 | 3 weeks |
| Bullish recovery | 20% | 1d close > 111,500 with OI rising | back below 107,000 | 3 weeks |

Four requirements:

1. **Sum to 100%** — check it, it is an addition you get wrong.
2. **Exclusive and exhaustive**: two scenarios cannot be true together, and the "none of the above" case does not exist.
3. **Thresholds in price and date**, not in impressions. "If momentum weakens" is not an observable condition.
4. **Identical horizon** for all: probabilities at different horizons do not add up.

## The probabilities: where they come from

They do not come out of your intuition. Three acceptable sources, to cite:

- **The historical frequency** of the comparable case (`taux-de-base`) — the default starting point.
- **Implied or realised volatility**: the probability of reaching a level is derived from the distance and the volatility.

```python
import pandas as pd, numpy as np
from math import erf, sqrt
c = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time")["close"]
sig = c.pct_change().tail(30).std()          # daily vol
jours, cible = 21, 103_000
d = np.log(cible / c.iloc[-1]) / (sig * sqrt(jours))
print(f"P(toucher {cible} en {jours} j) ≈ {0.5*(1+erf(d/sqrt(2))):.0%} (marche aléatoire, vol 30 j)")
```

- **An identified asymmetry** (positioning, flows, dated event), saying by how much it shifts the base probability and why.

And the guardrail: a probability of 5% or 95% over a three-week horizon in crypto is almost always a calibration error. Stay between 10% and 80% unless there is a strong argument.

## Calibration is a commitment

A 45% scenario must materialise about 45 times out of 100. Two practical consequences:

- **Record your forecast** with `Memory` (thresholds, horizon, probabilities) so you can reread it afterwards. It is the only way to know whether you are calibrated.
- **Reread the previous ones** when you open an analysis on the same asset: "my reading of 08/28 gave 60% to consolidation; it materialised / did not materialise, here is what I correct".

## What we do not write

- "Anything is possible", "the market will decide", "caution is warranted".
- A single scenario. A single announced path is a prediction, not an analysis.
- A probability without a horizon.
- Position advice ("buy here, stop there"): that is the Strategist profession, and it needs the user's framework.

## Related

- `taux-de-base`: the frequency that grounds the probability.
- `contradiction-obligatoire`: the inconvenient scenario must exist.
- `rapport-analyse`: where the scenarios sit in the report.
