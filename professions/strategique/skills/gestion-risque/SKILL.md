---
name: gestion-risque
description: The risk rules of a strategy or a portfolio — position size, daily and overall limits, correlation, leverage, stress scenarios — quantified
---

# Risk management

Risk is decided before the first position, in numbers, and is not renegotiated along the way. Every delivered strategy carries this section filled in.

## The layers

1. **Per position** — the risk is the loss if the stop is hit, not the size. Rule: risk ≤ R% of capital (1% is a common starting point; 0.5% for a frequent strategy; never more than 2%). Size = (capital × R) / (distance to stop in price). The stop is a market level (ATR, structure), not an arbitrary percentage.
2. **Per day / per week** — maximum cumulative loss before stopping (e.g. 3 R per day, 6 R per week). The stop is mechanical.
3. **Overall** — maximum accepted drawdown from the equity high (e.g. 15%). Halfway there (7.5%), sizes are halved; at the threshold, we stop and re-examine the strategy, not the parameters.
4. **Concentration** — maximum exposure per asset and per theme (altcoins are a single theme: they correlate at 0.8+ with BTC under stress). Sum of open risks ≤ 3–5 R.
5. **Leverage** — expressed as notional exposure / capital. On perps, real leverage includes funding: a funding of 0.05% / 8h costs ~55% per year; to be included in the carry cost and in the decision to hold.

## Stress scenarios

For each strategy, quantify the loss in:
- **Gap** of −20% on BTC in one hour (happens a few times a year): stops not executed at level, slippage ×5.
- **Liquidation cascade**: spread ×10 for a few minutes, orders partially filled.
- **Exchange outage or freeze**: impossible to exit for 1–6h.
- **Adverse regime**: the strategy takes N consecutive losses (compute N for a given win rate: at 40%, 8 losses in a row happen regularly).
If any of these cases exceeds the maximum drawdown, the size or the leverage is too large. Full stop.

## Correlation

Before opening a position, the question: what happens if the whole portfolio moves in the same direction? Measure the 30d correlation between assets (with BytNode's `get_history`); two positions at 0.9 correlation are one position of double size.

## What we write in the strategy

| Parameter | Value |
|---|---|
| Risk per position | …% of capital |
| Initial stop | … (market rule) |
| Max loss / day, / week | … R |
| Max drawdown, reduction threshold | …%, …% |
| Max exposure per asset / theme | …% |
| Max total open risk | … R |
| Max notional leverage | … × |
| Estimated loss in a −20% gap | …% of capital |

## Rules

- Limits are mechanical: we do not "see" whether to continue, we stop.
- We do not average down a losing position unless it is a rule written from the start.
- Risk is measured in R (multiple of the initial risk), not in euros: that is what makes strategies comparable.
