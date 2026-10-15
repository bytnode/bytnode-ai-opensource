---
name: controle-qualite-donnees
description: Open this as soon as a market CSV arrives, before any modelling — the check script (gaps, duplicates, jumps, zero volumes, OHLC consistency) and what to do with each anomaly
---

# Look at the data before modelling it

You go straight to the model. Nobody checks the history, and a single aberrant candle — a ten-hour gap, a zero price, a duplicate timestamp — is enough to produce a phantom signal, an invented Sharpe, a missing drawdown.

**Rule: the check below runs on every file, and its summary appears in the report. An unexplained anomaly forbids concluding.**

## The check

```python
import pandas as pd, numpy as np

def controle(csv: str, pas: str = "4h") -> None:
    df = pd.read_csv(csv, parse_dates=["time"]).set_index("time").sort_index()
    print(f"{len(df)} lignes — {df.index[0]} → {df.index[-1]}")

    # 1. duplicate timestamps
    dup = df.index.duplicated().sum()
    print(f"doublons : {dup}")

    # 2. gaps relative to the expected grid
    grille = pd.date_range(df.index[0], df.index[-1], freq=pas, tz=df.index.tz)
    manquants = grille.difference(df.index)
    print(f"trous : {len(manquants)} sur {len(grille)} attendus"
          + (f" — du {manquants[0]} au {manquants[-1]}" if len(manquants) else ""))

    # 3. OHLC consistency
    mal = ((df["high"] < df[["open", "close"]].max(axis=1)) |
           (df["low"] > df[["open", "close"]].min(axis=1)) |
           (df["high"] < df["low"])).sum()
    print(f"OHLC incoherents : {mal}")

    # 4. impossible values
    print(f"prix <= 0 : {(df[['open','high','low','close']] <= 0).any(axis=1).sum()}"
          f" — NaN : {int(df.isna().sum().sum())}"
          f" — volume nul : {(df.get('volume', pd.Series(1, index=df.index)) == 0).sum()}")

    # 5. abnormal jumps
    r = df["close"].pct_change()
    z = (r - r.mean()) / r.std()
    extremes = r[z.abs() > 8]
    print(f"sauts > 8 sigma : {len(extremes)}")
    for t, v in extremes.items():
        print(f"   {t} : {100*v:+.1f} %")

    # 6. flat price (frozen market / repeated data)
    plat = (r == 0).rolling(12).sum().max()
    print(f"plus longue serie de bougies sans variation : {int(plat or 0)}")
```

## What to do with each anomaly

| Anomaly | Decision |
|---|---|
| **Duplicates** | keep the last one (`~df.index.duplicated(keep="last")`); if the values differ, say so |
| **Short gaps** (1-2 candles) | `ffill` on prices, `0` on volume, and **count** the filled candles |
| **Long gaps** (> 6 candles) | do not fill: cut the history or treat the segments separately. A ten-hour `ffill` creates a false flat price, hence a false low volatility |
| **Inconsistent OHLC** | remove those rows, count them; beyond 0.1%, change source |
| **Jump > 8 σ** | check by hand: real dislocation (to keep, that is the market) or data error (to remove). Never clip silently |
| **Zero volume** | often a trading halt: exclude from volume calculations, do not exclude from price. BytNode leaves an unknown volume empty (NaN), never 0: count those apart |
| **Prolonged flat price** | symptom of a `ffill` already applied upstream or of a frozen market: suspect, to flag |

## Two crypto-specific traps

- **The current candle** is incomplete: remove it before any calculation (`horodatage`). BytNode's history serves closed candles; a row with `is_closed` false (from `live=true`, or an exchange's OHLCV) goes.
- **Rebases and contract changes** (redenominations, ticker migrations) produce a jump that is not a market move. An isolated > 8 σ jump on an altcoin is often that.

## The summary to cite

> **Data**: `data/btc_4h.csv`, 8,742 candles from 2022-01-01 to 2026-09-12 (expected grid 8,760, **18 gaps** of which 16 isolated and filled by `ffill`, and one 2-candle gap on 2024-03-05 kept as-is). 0 duplicates, 0 inconsistent OHLC, 3 jumps > 8 σ verified (real dislocations: 2024-08-05, 2025-02-03, 2025-10-10). Current candle excluded.

A report without this paragraph is not a quantitative report.

## Related

- `anti-fuite`: the next check, on the signal.
- `pieges-pandas`: the cleaning idioms that do not leak.
- `source-bytnode`: `SaveMarketData` to obtain the file.
