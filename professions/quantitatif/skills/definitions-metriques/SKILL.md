---
name: definitions-metriques
description: Open this when reporting performance metrics — the exact definition retained for each measure (Sharpe, drawdown, CAGR, exposure, R), so that two reports are comparable
---

# A metric without a definition is not a number

"Sharpe 1.4" means nothing until one knows: on which timeframe, annualised with which factor, net of what, with which risk-free rate. Two reports that do not share these choices are not comparable — and your flaw is to change them from one report to the next without saying so.

**The definitions below are those of the `Backtest` engine. Use them as-is, and cite them.**

## The house conventions

| Metric | Definition retained |
|---|---|
| **Period return** | net of fees, slippage and funding. `net = gross − costs − funding` |
| **Equity** | `(1 + net).cumprod()`, base 1. Full reinvestment, no withdrawal |
| **Total return** | `equity[-1] − 1` |
| **CAGR** | `equity[-1] ** (1 / years) − 1`, with `years = n_periods / periods_per_year`. Under one year, we give the raw period return **and** we say that annualisation is meaningless |
| **Volatility** | `std(net, ddof=1) × sqrt(periods_per_year)` |
| **Sharpe** | `mean(net) × ppy / annualised volatility`, **risk-free rate at 0** — to be stated, because it is a choice |
| **Sortino** | same numerator, denominator = standard deviation of the negative periods only |
| **Drawdown** | `equity / cummax(equity) − 1`, in **simple** terms (not log). The maximum is the minimum of this series |
| **Calmar** | `CAGR / |max drawdown|` |
| **Exposure** | share of periods with a non-zero position |
| **Position changes** | number of changes in exposure — what the engine calls `trades` |
| **Trade (round trip)** | an entry followed by an exit, a row of `trades.csv`. **Different** from the previous count: say which one you cite |
| **R** | gain or loss expressed in multiples of the initial risk (distance from entry to stop) |
| **Win rate** | on round trips, not on periods |
| **Periods per year** | 365 (1d), 2,190 (4h), 8,760 (1h). Never 252 in crypto |

## Comparison traps

- **Sharpe and timeframe**: a Sharpe computed on 1h and another on 1d do not compare directly. Cite the timeframe.
- **Simple vs log drawdown**: log gives a smaller number. We retain simple, because it is what the user feels on their account.
- **CAGR over a partial period**: annualising eleven days of gains gives hundreds of percent. The engine computes it; it is up to you not to put it forward.
- **Return of a long-short strategy**: relative to capital, not to notional. A 3× leverage multiplies the return and the drawdown by 3.
- **Buy-and-hold**: the engine's benchmark is 100% exposed at all times. A strategy exposed 30% of the time that does less well is not beaten for all that — also compare the return **per unit of risk** and per unit of exposure.

## What always accompanies a number

Three elements, otherwise the number does not go out:

1. **The period** and its actual duration.
2. **The number of trades**.
3. **The uncertainty**: the bootstrap interval, or failing that the mention "insufficient sample" (`statistiques-des-series`).

## The definitions block of the report

> **Conventions**: net returns (fees 6 bp + slippage 5 bp per side, real funding), equity in full reinvestment base 1, Sharpe annualised at 2,190 periods/year with zero risk-free rate, simple drawdown on equity, CAGR over 4.2 years. "Trades" = 74 round trips (`trades.csv`); the 148 position changes in the table count entries and exits separately.

A report that carries this block can be compared to another six months later. Without it, no.

## Related

- `backtest-python`: the engine that produces these numbers.
- `statistiques-des-series`: the uncertainty around each of them.
- `validation-statistique`: the verdict that uses them.
