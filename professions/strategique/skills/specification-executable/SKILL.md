---
name: specification-executable
description: Open this as soon as a strategy must be written — the template with mandatory fields, the "can it be coded" test, and the vague wordings to refuse
---

# A strategy that cannot be coded does not exist

Your flaw here is specific: you write **strategy prose**. "Enter when the trend reverses with volume confirmation, exit when momentum fades" reads very well and cannot be coded. Nobody can test it, so nobody can know whether it loses money.

**Rule: every field below is filled with a condition that `signal(df)` can evaluate on a given candle. If a field cannot be coded, the strategy is not finished.**

## The template

```markdown
## <strategy name>

**Intuition**: the economic reason for the edge, in one sentence. Why is
someone willing to lose money on the other side?

**Universe**: BTCUSDT, ETHUSDT (USDT-M perp). Why those.
**Timeframe**: 4h. Periods/year: 2,190.
**Direction**: long only / long-short.

**Entry**: exact condition, evaluated at the close of candle t,
executed at the open of t+1.
  e.g. close > MA200(close) AND MA20(close) > MA50(close)

**Exit**: exact condition, same execution rule.
  e.g. MA20 < MA50, OR stop hit, OR 30 candles elapsed

**Stop**: distance in price, computable at entry.
  e.g. 2 × ATR(14) below the entry price

**Size**: a rule, not a number.
  e.g. risk 1% of capital / distance to stop, notional ≤ 3× capital

**Regime filter**: when the strategy does not trade.
  e.g. no position if ATR(14)/close > 6% (extreme volatility)

**Costs assumed**: fees 6 bp/side, slippage 5 bp/side, real funding.

**Invalidation**: what makes one abandon the strategy — not a bad month,
a precise criterion.
  e.g. drawdown > 1.5 × the backtest's max drawdown, or 6 months without a new
  equity high
```

## The "can it be coded" test

For each condition, ask yourself: **on candle t, with only the data ≤ t, can I answer yes or no?** If the answer requires judgement, it is not a rule.

| Prose (refused) | Rule (accepted) |
|---|---|
| "when the trend reverses" | `MA20 crosses above MA50` |
| "with volume confirmation" | `volume > 1.5 × MA20(volume)` |
| "when momentum fades" | `RSI(14) < 50 after having exceeded 70` |
| "near a support" | `close < 1.01 × low of the last 20 candles` |
| "if the market is favourable" | `close > MA200` |
| "take profits progressively" | `exit 50% at +2R, the rest on a 1 ATR trailing stop` |

## What is forbidden in a condition

- **Future data**: the close of the signal candle for execution, a high "of the next 20 candles", a centred average. See `anti-fuite`.
- **An undeclared parameter**: every numeric threshold is a parameter, it counts in the budget (`budget-de-parametres`).
- **A condition on an asset for which you do not have the data.**

## Then

A complete specification translates into a ten-line strategy file, then gets tested:

```python
# strategies/tendance_4h.py
import pandas as pd

def signal(df: pd.DataFrame, fast: int = 20, slow: int = 50, regime: int = 200) -> pd.Series:
    c = df["close"]
    tendance = c > c.rolling(regime).mean()
    croise = c.rolling(fast).mean() > c.rolling(slow).mean()
    return (tendance & croise).astype(float)

def stop_distance(df: pd.DataFrame, atr: int = 14) -> pd.Series:
    return 2 * (df["high"] - df["low"]).rolling(atr).mean()
```

then `Backtest(data=…, strategy="strategies/tendance_4h.py", periods_per_year=2190)`.

As long as the specification is not tested, you do not say it "should work well": you say it is ready to be tested.

## Related

- `conception-strategie`: the overall approach.
- `budget-de-cout`: the edge must cover the frictions.
- `budget-de-parametres`: how many thresholds we allow ourselves.
- `plan-backtest`, `anti-fuite`: putting it to the test.
