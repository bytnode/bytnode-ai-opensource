---
name: anti-fuite
description: Open this before any backtest and every time a signal is written — the list of data leaks, and the mechanical test that detects them by recomputing the signal on truncated histories
---

# Look-ahead leakage, and how to prove it absent

This is the number one weakness of the code you write, and the most dangerous: it produces no error, no warning — only a magnificent backtest and a strategy that loses in live trading. The `Backtest` engine guarantees execution at the next candle, but **the leak can be in your `signal()`**, and there nobody protects you.

**Rule: no backtest is presented without the causality test below having been executed and its result cited.**

## The mechanical test

The signal at instant t must depend only on data ≤ t. So: recomputed on a history truncated at t, it must give the **same value**. One test, a binary answer.

```python
import numpy as np, pandas as pd, importlib.util

def charge(path):
    spec = importlib.util.spec_from_file_location("s", path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

def test_causalite(csv: str, strategy: str, params: dict | None = None, n: int = 30, seed: int = 0) -> None:
    df = pd.read_csv(csv, parse_dates=["time"]).set_index("time").sort_index()
    mod = charge(strategy)
    complet = mod.signal(df, **(params or {}))
    rng = np.random.default_rng(seed)
    coupes = rng.integers(int(len(df) * 0.5), len(df) - 1, n)
    fautes = []
    for t in coupes:
        tronque = mod.signal(df.iloc[: t + 1], **(params or {}))
        a, b = complet.iloc[t], tronque.iloc[-1]
        if not (pd.isna(a) and pd.isna(b)) and not np.isclose(float(a), float(b), equal_nan=True):
            fautes.append((df.index[t], float(a), float(b)))
    if fautes:
        print(f"FUITE : {len(fautes)}/{n} coupes divergent. Exemples : {fautes[:3]}")
    else:
        print(f"causalité OK sur {n} coupes aléatoires")
```

To run before every backtest, and to cite: "causality verified on 30 cuts". If a single cut diverges, the backtest result is worthless — fix it first.

## The leaks, by order of frequency

| Leak | What it looks like | The fix |
|---|---|---|
| **Centred average** | `rolling(20, center=True)` | `rolling(20)` |
| **Global normalisation** | `(x - x.mean()) / x.std()` over the whole series | `x.rolling(n).mean()` / `rolling(n).std()` |
| **Forgotten shift** | comparing `close[t]` to a threshold computed with `close[t]` included… and executing at `t` | the engine executes at `t+1`; your signal must be known **at the close of t** |
| **Backward fill** | `fillna(method="bfill")`, `interpolate()` | `ffill()` only, and count the gaps |
| **Future extremum** | `close / close.max()`, `idxmin()` over the whole series | `rolling(n).max()` |
| **Badly bounded resample** | `resample("1D")` with `label="right"` without `closed="right"` | set both, explicitly |
| **Missing sort** | unsorted index: `rolling` mixes epochs | `sort_index()` right at loading |
| **Universe chosen today** | backtesting 2022 on the liquid assets of 2026 | say so; universe defined at each date if possible |
| **Parameter tuned on the whole history** | choosing `slow=40` because it is the best over 2022-2026, then "testing" over 2022-2026 | calibrate in-sample, look at the out-of-sample only once |

## The two leaks no test detects

1. **Leakage through the eyes.** You looked at the full chart before writing the rule: "buy the June dips" is not causal, even if the code is. Describe the rule before looking at the test period.
2. **Leakage through iteration.** Fifty variants tried on the same data: the out-of-sample information leaked through you. The only protection is to count K honestly (`budget-de-parametres`) and to deflate (`validation-statistique`).

## What must appear in the report

> **Causality**: test on 30 random cuts — no divergence. No global normalisation, no `center=True`, sorted index, `ffill` only (14 gaps filled out of 8,760 candles, listed). Universe fixed in advance (BTCUSDT, ETHUSDT), selected for liquidity in 2022 — residual survivorship bias flagged.

## Related

- `controle-qualite-donnees`: to do beforehand, on the data itself.
- `pieges-pandas`: the idioms that produce these leaks.
- `backtest-python`, `validation-statistique`: the rest of the protocol.
