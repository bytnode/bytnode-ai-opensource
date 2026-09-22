---
name: backtest-python
description: Write an honest vectorised backtest in pandas — causal signal, execution at the next candle, fees, slippage, funding, complete metrics, curves — from a specified strategy
---

# Backtest in Python

**The `Backtest` tool first.** BytNode-AI has a standard engine (execution at the next candle, fees + slippage, funding, risk-based sizing, in/out-of-sample split, metrics by period and by year, buy-and-hold benchmark, equity curve): you only write the strategy file —

```python
# strategies/sma_cross.py
import pandas as pd

def signal(df: pd.DataFrame, fast: int = 10, slow: int = 50) -> pd.Series:
    """-1 / 0 / 1, computed with data ≤ t (causal rolling)."""
    f = df["close"].rolling(fast).mean()
    s = df["close"].rolling(slow).mean()
    return (f > s).astype(float)          # long only; (f > s) - (f < s) for long/short

def stop_distance(df: pd.DataFrame, atr: int = 14) -> pd.Series:
    """Optional: distance to the stop in price (here 2·ATR) → risk-based sizing."""
    tr = (df["high"] - df["low"]).rolling(atr).mean()
    return 2 * tr
```

then `Backtest(data="data/btc_4h.csv", strategy="strategies/sma_cross.py", params={"fast": 10, "slow": 50}, periods_per_year=2190)`. The data comes from `SaveMarketData`. Rerun with the parameters at ±20% and ±50% for sensitivity (`validation-statistique`).

The skeleton below is used **only** when the strategy does not fit into `signal` / `stop_distance` (pyramiding, intra-candle stops, size depending on current capital): then, event-driven, by hand.

For a strategy written with `conception-strategie` and a `plan-backtest` plan. Vectorised when the rules allow it (one position per asset, size fixed at the signal); event-driven (loop) as soon as there is pyramiding, intra-candle stops or size depending on current capital.

## Vectorised skeleton

```python
import numpy as np, pandas as pd

FEE = 0.0006        # taker, per side — real value of the targeted exchange
SLIPPAGE = 0.0005   # per side; higher on altcoins / under stress
RISK = 0.01         # risk per position, fraction of capital

def backtest(df: pd.DataFrame, signal: pd.Series, stop_dist: pd.Series) -> dict:
    """df: OHLCV (+ funding if perp), UTC index. signal ∈ {−1, 0, 1} computed with data ≤ t.
    stop_dist: distance to the stop in price, at the time of the signal (e.g. 2·ATR)."""
    # Execution at the OPEN of the next candle: never at the signal candle.
    pos = signal.shift(1).fillna(0)
    px = df["open"]
    # Size: fixed risk / distance to stop, bounded (max notional leverage 3×).
    size = (RISK / (stop_dist.shift(1) / px)).clip(upper=3.0).fillna(0) * pos.abs()
    ret = px.pct_change().fillna(0)
    gross = pos * size * ret
    turnover = (pos * size).diff().abs().fillna(0)
    costs = turnover * (FEE + SLIPPAGE)
    funding = (df["funding"].fillna(0) * pos * size) if "funding" in df else 0
    net = gross - costs - funding
    equity = (1 + net).cumprod()
    return {"net": net, "equity": equity, "pos": pos, "size": size, "costs": costs}
```

The intra-candle stop cannot be represented in vectorised form: if the strategy depends on it, switch to event-driven (loop over the candles, explicit state: position, entry price, current stop), and document that stops are executed at the **worst** of the candle (`low` for a long) — that is the conservative version.

## Metrics (all of them)

```python
def metrics(net: pd.Series, equity: pd.Series, periods_per_year: int) -> dict:
    ann = periods_per_year
    mu, sd = net.mean() * ann, net.std(ddof=1) * np.sqrt(ann)
    downside = net[net < 0].std(ddof=1) * np.sqrt(ann)
    dd = equity / equity.cummax() - 1
    trades = (net != 0).astype(int).diff().eq(1).sum()  # vectorised approximation: replace with the real count in event-driven
    return {
        "rendement_annualise": (equity.iloc[-1]) ** (ann / len(net)) - 1,
        "volatilite": sd, "sharpe": mu / sd if sd else np.nan,
        "sortino": mu / downside if downside else np.nan,
        "drawdown_max": dd.min(), "calmar": ((equity.iloc[-1]) ** (ann / len(net)) - 1) / abs(dd.min()) if dd.min() else np.nan,
        "exposition": (net != 0).mean(), "trades": int(trades),
        "plus_longue_serie_pertes": int((net < 0).astype(int).groupby((net >= 0).cumsum()).sum().max()),
    }
```

`periods_per_year`: 365 for daily crypto (the market does not close), 365×6 on 4h, 365×24 on 1h.

## Mandatory outputs

- `out/<exp>/metrics.json` — the dictionary above, **by period** (in-sample, out-of-sample, each year) and by regime.
- `out/<exp>/equity.png` — equity curve + drawdown, with the buy-and-hold benchmark.
- `out/<exp>/trades.csv` — in event-driven: entry, exit, realised R, duration.
- The summary printed in the answer: table of metrics by period, then the verdict from `validation-statistique`.

## Traps

- **Look-ahead leakage**: a `rolling(...).mean()` is causal; a `rolling(..., center=True)` is not; a normalisation over the whole series is not either.
- **Survivorship**: an altcoin universe chosen today excludes those that died. Say so; if possible, universe defined at each date.
- **Zero fees**: a backtest without fees on a short timeframe is not a backtest.
- **A single asset, a single period**: not proof — see `validation-statistique`.
- **The vectorised trade count** is approximate: if the number matters (it does), switch to event-driven.
