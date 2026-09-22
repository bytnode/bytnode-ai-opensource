---
name: plan-backtest
description: Specify the validation of a strategy before coding it — data, period, out-of-sample, frictions, metrics, rejection thresholds — to hand it to a quant
---

# Backtest plan

A backtest without a plan written in advance always finds what one wants to see in it. The plan fixes, **before** looking at the results, what will be measured and what will cause the strategy to be rejected.

## The plan

```
## Data
Assets; timeframe; source (BytNode `get_history`); total period available.
Required fields: OHLCV at minimum; funding and OI if perp; BytNode indicators if used.

## Split
- Calibration (in-sample): e.g. the oldest 2/3.
- Out-of-sample: the most recent 1/3, looked at ONCE, at the end.
- Better: walk-forward — rolling calibration windows then test.
The period must contain at least one bull market, one bear market and one range.

## Frictions
Fees: maker …%, taker …% (real values of the targeted exchange).
Slippage: …% per order, higher on altcoins and under stress.
Funding on perps: real, taken from the history, not an average.
Execution: at the close of the next candle, never at the signal candle.

## Metrics (all of them, not only the return)
- Annualised return and maximum drawdown → Calmar ratio.
- Sharpe and Sortino (state the risk-free rate and the frequency).
- Number of trades, win rate, average win / average loss, expectancy in R.
- Average position duration; longest losing streak.
- Average exposure (time in position); return per unit of exposure.
- Stability: same metrics per year and per regime.

## Rejection thresholds (fixed now)
E.g.: max drawdown > 20%; out-of-sample Sharpe < 0.8; fewer than 50 trades;
out-of-sample degradation > 40% relative to calibration;
result that disappears when a parameter moves by ±20%.

## Robustness
- Sensitivity: each parameter ±20%, ±50% → performance must degrade gently.
- Offset: start the backtest at different dates.
- Neighbouring assets: does the logic hold on ETH if designed on BTC?
- Comparison to a benchmark: buy-and-hold, and a version with random entries and the same exits.
```

## What we hand to the Quant

The `conception-strategie` canvas filled in + this plan. The quant must not have to choose a period, a friction or a metric: those choices belong to the strategy, and making them after the fact is cheating without meaning to.

## What we refuse

- A backtest without fees or slippage.
- A single period, or a period without a bear market.
- An optimisation over the whole period then a "test" on the same one.
- A result without number of trades or drawdown.
- Concluding on fewer than 30–50 trades.
