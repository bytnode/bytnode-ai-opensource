---
name: python-quant
description: The way of working in Python for quantitative research — structure of an experiment script, loading BytNode data into pandas, quality checks, reproducibility, execution and outputs
---

# Python for quantitative research

## Environment

- Check first which Python runs: on macOS / Linux `python3` (plain `python` often does not exist there), on Windows `python` (or `py`). Then `python3 --version` and `python3 -c "import pandas, numpy, scipy, statsmodels, matplotlib"` — with `python` on Windows. Is a package missing? `python3 -m pip install pandas numpy scipy statsmodels matplotlib` (`python -m pip …` on Windows) — and say so. Use the same command in every script you run afterwards.
- One `.py` script per experiment, in the workspace, under `research/`; raw data under `data/`, outputs under `out/`. A notebook only if asked for (NotebookEdit).

## Structure of an experiment script

```python
"""exp_<name>.py — <hypothesis in one sentence>."""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np, pandas as pd

# --- Parameters, at the top, all named ---
ASSET = "BTC"; TIMEFRAME = "1d"; LOOKBACK = 20; SEED = 42
OUT = Path("out") / "exp_<nom>"; OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(SEED)

def load(asset: str, timeframe: str) -> pd.DataFrame:
    """Reads data/<asset>_<timeframe>.csv written from BytNode (see below)."""
    df = pd.read_csv(f"data/{asset}_{timeframe}.csv", parse_dates=["time"]).set_index("time").sort_index()
    return check(df)

def check(df: pd.DataFrame) -> pd.DataFrame:
    assert df.index.is_unique, "doublons d'horodatage"
    assert df.index.tz is not None, "index sans fuseau : attendu UTC"
    gaps = df.index.to_series().diff().value_counts()
    if len(gaps) > 1: print("trous dans la série :", gaps.head(), file=sys.stderr)
    assert (df[["open","high","low","close"]] > 0).all().all(), "prix non positifs"
    return df

def main() -> None:
    df = load(ASSET, TIMEFRAME)
    # ... calculations ...
    results = {"n": len(df), "...": ...}
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
```

## BytNode data → CSV

BytNode is read through your tools (`get_market_data`, `get_market_indicators`), not from Python. The chain:
1. `SaveMarketData(tool="get_market_data", args={"symbol": "BTCUSDT", "timeframe": "1d", "klines": true, "since_ms": …, "until_ms": …}, output="data/BTC_1d.csv")` — the history of the asset, the timeframe and the period, written as CSV without going through the conversation (columns `time,open,high,low,close,volume,…`, `time` in ISO 8601 UTC, rows in chronological order). Funding (`funding_rate`: `rate_pct`, % per 8h) and open interest (`oi`) go to their own files: merge them on `time` in the script.
2. The script reads the CSV. Note in `out/…/results.json` the retrieval date and the bounds of the series.
BytNode never cuts a period silently: read the summary. If a period does not fit in one call (the error gives the step that would, or `ranges` says `truncated` with `next_until_ms`), split it into periods, oldest first, with `append: true`; then sort and check for the absence of duplicates at the joins.

## Rules

- **Everything in UTC**, tz-aware `DatetimeIndex` index. Log returns (`np.log(close).diff()`) for aggregation, simple for display.
- **No look-ahead leakage**: every signal at t uses only data ≤ t; `rolling` is causal by default, `shift(1)` before acting on the signal.
- **Vectorise**; a Python loop over candles is only acceptable for an explicit event-driven backtest.
- **Reproducible**: fixed seed, parameters at the top, versions printed (`pd.__version__`).
- **Show**: execute the script, paste the output; save figures as PNG in `out/` and read them with Read to comment on them.
- One experiment = one question. If you have three, three scripts.
