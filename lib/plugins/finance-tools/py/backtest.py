"""BytNode-AI's backtest engine — the same implementation every time.

Usage (by the Backtest tool):
    python backtest.py <config.json>

The configuration file:
    data            OHLCV CSV (columns recognised by their usual names)
    strategy        Python file that defines `signal(df) -> pd.Series`
                    (values -1 / 0 / 1, computed with the data <= t)
                    and, optionally, `stop_distance(df) -> pd.Series`
                    (distance to the stop in price; without it, fixed size)
    params          dict passed to signal(df, **params) if the function accepts it
    fee, slippage   per side, as a fraction (0.0006 = 6 bp)
    risk            fraction of the capital risked per position (with a stop)
    max_leverage    bound on the size (notional / capital)
    periods_per_year  365 (daily crypto), 365*6 (4 h), 365*24 (1 h)…
    split           in-sample fraction (0.7 = 70 % IS, 30 % OOS)
    out_dir         output folder

Non-negotiable principles (see the backtest-python skill):
  - execution at the OPEN of the NEXT candle, never at the signal's;
  - fees + slippage on every position change;
  - funding (`funding` column, per period) when present;
  - metrics per period (IS / OOS / per year);
  - the trade count is the number of position changes.
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

TIME_NAMES = ["time", "timestamp", "date", "datetime", "t", "ts", "open_time", "opentime"]
COL_NAMES = {
    "open": ["open", "o"],
    "high": ["high", "h"],
    "low": ["low", "l"],
    "close": ["close", "c", "price", "last", "value"],
    "volume": ["volume", "vol", "v"],
    "funding": ["funding", "funding_rate", "fundingrate"],
}


def fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    sys.exit(1)


def find_col(columns: list[str], candidates: list[str]) -> str | None:
    lower = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand in lower:
            return lower[cand]
    for cand in candidates:
        for lc, c in lower.items():
            if lc.endswith("." + cand) or lc.endswith("_" + cand):
                return c
    return None


def load_data(path: str) -> pd.DataFrame:
    raw = pd.read_csv(path)
    cols = list(raw.columns)
    tcol = find_col(cols, TIME_NAMES)
    if tcol is None:
        fail(f"No time column in {cols}")
    t = raw[tcol]
    if np.issubdtype(t.dtype, np.number):
        unit = "ms" if t.iloc[0] > 1e11 else "s"
        idx = pd.to_datetime(t, unit=unit, utc=True)
    else:
        idx = pd.to_datetime(t, utc=True, errors="coerce")
    df = pd.DataFrame(index=idx)
    for std, cands in COL_NAMES.items():
        c = find_col(cols, cands)
        if c is not None:
            df[std] = pd.to_numeric(raw[c], errors="coerce").values
    if "close" not in df:
        fail(f"No price column in {cols}")
    for k in ("open", "high", "low"):
        if k not in df:
            df[k] = df["close"]
    # The other columns (indicators already computed) stay available.
    for c in cols:
        if c != tcol and c not in df.columns:
            df[c] = pd.to_numeric(raw[c], errors="coerce").values
    df = df[~df.index.isna()].sort_index()
    df = df[~df.index.duplicated(keep="last")]
    return df


def load_strategy(path: str):
    spec = importlib.util.spec_from_file_location("strategy", path)
    if spec is None or spec.loader is None:
        fail(f"Unreadable strategy: {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["strategy"] = mod
    spec.loader.exec_module(mod)
    if not hasattr(mod, "signal"):
        fail("The strategy file must define `signal(df) -> pd.Series` (values -1, 0, 1).")
    return mod


def call_with_params(fn, df: pd.DataFrame, params: dict):
    sig = inspect.signature(fn)
    accepts = {k for k in sig.parameters if k != "df"}
    has_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
    kw = {k: v for k, v in params.items() if has_kwargs or k in accepts}
    return fn(df, **kw)


def run(df: pd.DataFrame, signal: pd.Series, stop_dist: pd.Series | None, cfg: dict) -> pd.DataFrame:
    fee = float(cfg.get("fee", 0.0006))
    slip = float(cfg.get("slippage", 0.0005))
    risk = float(cfg.get("risk", 0.01))
    max_lev = float(cfg.get("max_leverage", 3.0))

    sig = pd.Series(signal, index=df.index).astype(float).clip(-1, 1).fillna(0.0)
    # Execution at the open of the next candle.
    pos = sig.shift(1).fillna(0.0)
    px = df["open"].astype(float)
    if stop_dist is not None:
        sd = pd.Series(stop_dist, index=df.index).astype(float).shift(1)
        with np.errstate(divide="ignore", invalid="ignore"):
            size = (risk / (sd / px)).replace([np.inf, -np.inf], np.nan)
        size = size.clip(upper=max_lev).fillna(0.0)
    else:
        size = pd.Series(1.0, index=df.index)
    # The size is set at ENTRY and kept until the exit: a moving stop does
    # not make the position trade at every candle.
    entry = pos.ne(pos.shift(1).fillna(0.0)) & (pos != 0)
    size = size.where(entry).ffill().fillna(0.0)
    exposure = pos * size
    ret = px.pct_change().fillna(0.0)
    gross = exposure * ret
    turnover = exposure.diff().abs().fillna(exposure.abs())
    costs = turnover * (fee + slip)
    funding = (df["funding"].fillna(0.0) * exposure) if "funding" in df else pd.Series(0.0, index=df.index)
    net = gross - costs - funding
    equity = (1.0 + net).cumprod()
    out = pd.DataFrame({"open": px, "close": df["close"], "signal": sig, "position": pos, "size": size, "exposure": exposure, "ret": ret, "gross": gross, "costs": costs, "funding": funding, "net": net, "equity": equity})
    return out


def metrics(net: pd.Series, equity: pd.Series, exposure: pd.Series, ppy: int) -> dict:
    n = len(net)
    if n < 2:
        return {"periods": n}
    mu = net.mean() * ppy
    sd = net.std(ddof=1) * math.sqrt(ppy)
    downside = net[net < 0].std(ddof=1) * math.sqrt(ppy) if (net < 0).sum() > 1 else float("nan")
    dd = equity / equity.cummax() - 1.0
    total = float(equity.iloc[-1] / equity.iloc[0]) if equity.iloc[0] else float("nan")
    years = n / ppy
    cagr = total ** (1 / years) - 1 if years > 0 and total > 0 else float("nan")
    changes = exposure.diff().fillna(exposure).abs() > 1e-12
    trades = int(changes.sum())
    losing = (net < 0).astype(int)
    streak = int(losing.groupby((net >= 0).cumsum()).sum().max()) if n else 0
    active = net[exposure != 0]
    win_rate = float((active > 0).mean()) if len(active) else float("nan")

    def f(x):
        return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else float(x)

    return {
        "periods": n,
        "years": f(years),
        "total_return": f(total - 1),
        "cagr": f(cagr),
        "volatility": f(sd),
        "sharpe": f(mu / sd) if sd else None,
        "sortino": f(mu / downside) if downside and not math.isnan(downside) else None,
        "max_drawdown": f(dd.min()),
        "calmar": f(cagr / abs(dd.min())) if dd.min() and not math.isnan(cagr) else None,
        "exposure": f((exposure != 0).mean()),
        "trades": trades,
        "win_rate_periods": f(win_rate),
        "longest_losing_streak": streak,
    }


def trades_table(res: pd.DataFrame) -> pd.DataFrame:
    rows = []
    in_pos = 0.0
    entry_px = None
    entry_t = None
    eq_entry = None
    for t, r in res.iterrows():
        e = r["exposure"]
        if abs(e - in_pos) > 1e-12:
            if in_pos != 0 and entry_t is not None:
                rows.append({"entry": entry_t, "exit": t, "side": "long" if in_pos > 0 else "short", "entry_price": entry_px, "exit_price": r["open"], "return": (r["equity"] / eq_entry - 1.0) if eq_entry else None})
            if e != 0:
                entry_px, entry_t, eq_entry = r["open"], t, r["equity"]
            in_pos = e
    return pd.DataFrame(rows)


def main() -> None:
    if len(sys.argv) < 2:
        fail("usage: backtest.py <config.json>")
    cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf8"))
    df = load_data(cfg["data"])
    strat = load_strategy(cfg["strategy"])
    params = cfg.get("params") or {}
    sig = call_with_params(strat.signal, df, params)
    stop = call_with_params(strat.stop_distance, df, params) if hasattr(strat, "stop_distance") else None
    ppy = int(cfg.get("periods_per_year", 365))
    res = run(df, sig, stop, cfg)

    out_dir = Path(cfg["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    split = float(cfg.get("split", 0.7))
    k = int(len(res) * split)
    periods = {"all": res, "in_sample": res.iloc[:k], "out_of_sample": res.iloc[k:]}
    for year, part in res.groupby(res.index.year):
        periods[str(year)] = part
    report = {}
    for name, part in periods.items():
        if len(part) < 2:
            continue
        eq = (1.0 + part["net"]).cumprod()
        report[name] = metrics(part["net"], eq, part["exposure"], ppy)
    # Reference: buy and hold.
    bh = res["ret"]
    report["buy_and_hold"] = metrics(bh, (1.0 + bh).cumprod(), pd.Series(1.0, index=res.index), ppy)

    res.to_csv(out_dir / "equity.csv", index_label="time")
    tr = trades_table(res)
    tr.to_csv(out_dir / "trades.csv", index=False)
    (out_dir / "metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf8")
    print(json.dumps({
        "ok": True,
        "rows": len(res),
        "start": str(res.index[0]),
        "end": str(res.index[-1]),
        "split_at": str(res.index[k]) if 0 < k < len(res) else None,
        "trades": int(len(tr)),
        "metrics": report,
        "files": {"equity": str(out_dir / "equity.csv"), "trades": str(out_dir / "trades.csv"), "metrics": str(out_dir / "metrics.json")},
    }, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        fail(f"{type(exc).__name__}: {exc}")
