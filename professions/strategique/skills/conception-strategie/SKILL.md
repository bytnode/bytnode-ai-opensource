---
name: conception-strategie
description: The canvas of a trading or investment strategy written to be executed and tested — intention, hypothesis, universe, quantified rules, execution, weaknesses
---

# Strategy design

The deliverable is a document that someone else can apply or code without asking you a question. If it must be written, `strategie-<name>.md` in the workspace.

## Canvas

```
# Strategy <name>

## Intention
One sentence. E.g.: capture multi-week trends on BTC and ETH while limiting drawdown to 15%.

## Constraints
Capital; horizon; max drawdown; decision frequency (per 4h candle, daily…);
allowed markets (spot / perp / options); max leverage; practical constraints (time available, automation).

## Market hypothesis
Where the edge comes from, in two sentences, and why it should persist.
E.g.: crypto trends persist over several weeks because flows (ETF, stablecoins) are
autocorrelated; the edge disappears in a range, hence a regime filter.

## Universe
Assets and selection criteria (minimum liquidity: 24h volume > X, spread < Y).

## Rules
| Element | Rule | Parameter |
|---|---|---|
| Regime / filter | e.g. close > daily MA200 and ADX(14) > 20 | 200, 14, 20 |
| Entry | e.g. 4h close above the 20-candle high | 20 |
| Size | e.g. risk 1% of capital per position, size = 1% / distance to stop | 1% |
| Initial stop | e.g. 2 × ATR(14) below entry | 2, 14 |
| Exit | e.g. trailing stop 3 × ATR or close below 4h MA50 | 3, 50 |
| Pyramiding | allowed / not; conditions | |
| Time | forced exit after N candles without progress | N |

## Risk
Refer to `gestion-risque`: limits per position, per day, overall; correlation between positions;
leverage; behaviour under stress (gap, liquidation cascade, exchange outage).

## Execution
Order types; assumed fees (maker/taker); assumed slippage; execution window;
what to do if the price has already moved more than X% by the time of acting.

## Validation
Refer to `plan-backtest`: period, out-of-sample, metrics, rejection thresholds.

## Known weaknesses
Regimes where it loses; parameter sensitivity; friction cost; what would break the hypothesis.
```

## Design rules

- **One hypothesis, one strategy.** Two hypotheses = two strategies, possibly combined after testing.
- **Every rule has a named parameter** and a default value. The quant will vary them; you say which ones matter.
- **Few parameters.** Beyond five or six, the strategy fits the past more than the market.
- **The exit matters more than the entry.** It is quantified before the entry.
- **Friction is a rule.** A 1h strategy on an illiquid asset dies of its fees: say so at design time, not at backtest time.
- **The regime is a filter, not an excuse.** If the strategy only works in a trend, the regime detection rule is part of the strategy.
- Anchor default values in real data (BytNode): recent volatility for the ATR, volumes for the universe, funding for carry costs on perps.
