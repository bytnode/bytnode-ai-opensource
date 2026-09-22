---
name: pieges-pandas
description: Open this when writing pandas on market time series — the exact idioms for resample, alignment, shifting, time zones, floats, and the constructs that produce wrong results without an error
---

# The idioms that do not lie

Your pandas errors raise no exception: they shift a series by one candle, misalign two assets, or compare two floats. The code runs, the result is wrong. Here are the constructs to use, and those never to write.

## Loading, once and for all

```python
import pandas as pd

df = (pd.read_csv("data/btc_4h.csv", parse_dates=["time"])
        .set_index("time")
        .sort_index())                       # ⚠️ without sorting, rolling mixes epochs
df = df[~df.index.duplicated(keep="last")]
if df.index.tz is None:
    df.index = df.index.tz_localize("UTC")   # everything in UTC, always
```

If time is numeric: `pd.to_datetime(t, unit="ms" if t.iloc[0] > 1e11 else "s", utc=True)`.

## Resample: the four arguments that matter

```python
j = df.resample("1D", label="left", closed="left", origin="epoch").agg(
    {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
)
```

- `label`: which timestamp the period carries. `left` = the period is named by its start — the candle convention.
- `closed`: which edge is included. **`label` and `closed` must be consistent**, otherwise the candle is shifted by one period.
- `origin="epoch"`: otherwise the grid depends on the first row of the file and two assets no longer align.
- The last group is **partial**: `j = j.iloc[:-1]` if you only want complete periods.

## Shifts and windows

```python
c = df["close"]
c.shift(1)                      # the previous value — causal
c.shift(-1)                     # ⛔ the future: never in a signal
c.rolling(20).mean()            # causal, NaN on the first 19
c.rolling(20, center=True)      # ⛔ uses the future
c.rolling(20, min_periods=1)    # ⚠️ average over 3 points at the start: avoid, keep the NaN
c.ewm(span=20, adjust=False)    # causal exponential
c.diff(), c.pct_change()        # shift of 1 by default
```

The NaN at the start are **information**: they say the indicator does not exist yet. Filling them (`fillna(0)`, `bfill`) creates phantom signals at the start of the history.

## Aligning two assets

```python
a = charge("data/btc_4h.csv")["close"].rename("btc")
b = charge("data/eth_4h.csv")["close"].rename("eth")
paire = pd.concat([a, b], axis=1, join="inner")      # inner: only the common dates
corr = paire["btc"].pct_change().rolling(90).corr(paire["eth"].pct_change())
```

`join="outer"` (the `concat` default) manufactures NaN, which a `ffill` then turns into false prices. For a correlation, `inner` is the only honest choice — and say how many rows were lost.

⛔ `a.corr(b)` on **prices**: two rising series are correlated at 0.99 without meaning anything. Correlation is computed on **returns**.

## Floats

```python
import numpy as np
if np.isclose(a, b): ...          # ✅
if a == b: ...                    # ⛔ on floats
croise = (f > s) & (f.shift(1) <= s.shift(1))    # a crossover, done properly
```

## The constructs to ban

| ⛔ | ✅ | Why |
|---|---|---|
| `df.append(...)` | `pd.concat([...])` | removed from pandas 2 |
| `df["x"][df.y > 0] = 1` | `df.loc[df.y > 0, "x"] = 1` | chained assignment: silently without effect |
| `inplace=True` | reassign | ambiguous behaviour, discouraged upstream |
| `iterrows()` over 10,000 rows | vectorised operations | a thousand times slower, and `r["close"]` loses the type |
| `df.dropna()` at the end of a chain | `dropna(subset=[...])` | removes rows because of a secondary column |
| `apply(lambda …)` per row | `np.where`, `.clip`, `.mask` | slow, and masks type errors |

## The shape check

After every transformation that changes the granularity or joins series:

```python
print(len(df), df.index.is_monotonic_increasing, df.index.tz, df.isna().sum().to_dict())
```

Three lines that save hours: expected length, sorted index, time zone set, NaN counted.

## Related

- `anti-fuite`: the test that proves none of these traps leaked.
- `controle-qualite-donnees`: what we check before transforming.
- `python-quant`: the overall approach.
