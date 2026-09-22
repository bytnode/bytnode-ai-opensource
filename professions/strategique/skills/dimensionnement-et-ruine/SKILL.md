---
name: dimensionnement-et-ruine
description: Open this to set a position size or a leverage — risk per trade, total heat, correlation between positions, distance to liquidation, and the risk-of-ruin calculation
---

# Size is calculated; leverage is suffered

You spontaneously propose "risk 2% per trade" or "5× leverage" as conventions. They are not conventions: they are decisions that determine the survival of the account, and they depend on the distance to the stop, the correlation between positions and the real win rate.

## 1. The size of a position

```
notional_size = capital × risk_per_trade / (distance_to_stop / entry_price)
```

The risk per trade is a **fraction of capital**, the distance to the stop a **fraction of price**. Never confuse the two: "stop at 5%" with "risk 1%" gives a notional of 20% of capital, not 1%.

```python
capital, risque, prix, stop = 10_000, 0.01, 111_240, 106_000
distance = (prix - stop) / prix
notionnel = capital * risque / distance
print(f"distance {100*distance:.2f} % — notionnel {notionnel:,.0f} USDT "
      f"({notionnel/capital:.2f}× capital) — perte au stop {capital*risque:,.0f} USDT")
```

And the bound: **notional ≤ 3 × capital** unless explicitly justified. Beyond that, liquidation comes before the stop.

## 2. Total heat

Portfolio risk is not the sum of the risks per trade: correlated positions are **a single position**. In crypto, the correlation between majors often exceeds 0.8 — five longs on five different assets is one long of quintuple size.

```python
import pandas as pd
closes = pd.read_csv("data/majeures_1d.csv", parse_dates=["time"]).set_index("time")
r = closes.pct_change().tail(90)
print(r.corr().round(2))
```

Rules of conduct:

- **Heat** = sum of the risks of open positions. Ceiling: **6%** of capital.
- Two assets with correlation > 0.7 count as **one** in this total.
- A single correlated group does not exceed 3% of heat.

## 3. Liquidation, before the stop

On a perpetual, liquidation is triggered on the **mark**, at an approximate distance of `1/leverage` (minus maintenance margin).

| Leverage | Distance ~ to liquidation |
|---|---|
| 3× | 33% |
| 5× | 20% |
| 10× | 10% |
| 20× | 5% |

**The stop must be reached well before liquidation**: distance to stop ≤ half the distance to liquidation. A 15% stop under 10× leverage does not exist — the account is liquidated first.

## 4. Risk of ruin

At win rate `p`, win/loss ratio `b` and risk `f` per trade, the probability of losing a fraction of capital is simulated. Do not estimate it: compute it.

```python
import numpy as np
rng = np.random.default_rng(0)
p, b, f, n, sims = 0.40, 2.5, 0.01, 200, 20_000
gains = np.where(rng.random((sims, n)) < p, f * b, -f)
equity = np.cumprod(1 + gains, axis=1)
dd = (equity / np.maximum.accumulate(equity, axis=1) - 1).min(axis=1)
print(f"perte finale > 20 % : {(equity[:, -1] < 0.8).mean():.1%}")
print(f"drawdown médian {np.median(dd):.1%} — pire décile {np.quantile(dd, 0.1):.1%}")
```

Use the output to choose `f`, and give it to the user: it is the number that matters to them, more than the annualised return.

**The Kelly fraction** (`f* = p - (1-p)/b`) is the growth maximum, not a recommendation: it produces intolerable drawdowns. Practice is **a quarter to a half of Kelly**, and never above 2% per trade with a win rate estimated on fewer than 100 trades.

## 5. What must appear in every proposal

> **Sizing**: risk 1% per trade, stop at 2×ATR (≈ 4.7% of price) → notional ≈ 2.1× capital, effective leverage 2.1× (liquidation at ~45%, stop at 4.7%: sufficient margin). Maximum heat 4% over two positions correlated at 0.82, counted as one. Simulation over 200 trades (p = 0.40, b = 2.5): median drawdown −11%, worst decile −24%, probability of losing more than 20% of capital: 9%.

## Related

- `gestion-risque`: the overall approach.
- `conventions-marche`: mark, liquidation, leverage.
- `budget-de-cout`: the cost enters the net edge before any sizing.
