---
name: conventions-marche
description: Open this when a data point carries a unit or a market convention — funding, perpetual versus spot, basis points, base or quote volume, mark versus index, liquidation — so as not to misread a correct number
---

# Reading a market number without distorting it

These are not reasoning errors: they are misread units. They produce conclusions that are wrong by a factor of 3, 100 or 1,000, without anything looking abnormal.

## Perpetual, spot, future

BytNode covers **USDT-margined perpetuals** (`BTCUSDT`, `ETHUSDT`…) and their spot markets. A perpetual has no expiry: it stays pinned to spot by the **funding**, paid between longs and shorts.

- The price of a perp is not the spot price. The gap is called the **basis**: `(perp / spot - 1)`.
- `USDCUSDT` and `USDTUSDC` are stablecoin pairs, spot only (no funding, no open interest): a 0.2% move there is an event, not noise. Do not compare them to BTC.
- A perp "volume" is notional traded, not a quantity of coins held. It says nothing about adoption.

## Funding

Published **per funding period** (generally 8h), as a fraction or a percentage — check which. BytNode normalises every venue to an **8h equivalent, in percent** (`estimated_rate_pct`, `rate_pct`: `0.01` = 0.01 %) and gives the annualised rate (`apr_pct`).

```
funding 0.01% / 8h  →  0.03% / day  →  ~10.95% / year
annualised = f * 3 * 365
```

- Positive sign: longs pay shorts (market leaning long). Negative: the reverse.
- On a position held several days, funding is often the first cost item — more than fees. It goes into `budget-de-cout`.
- Extreme funding is a positioning indicator, not a forecast of direction.

## Percentages and basis points

| Notation | Value |
|---|---|
| 1 bp | 0.01% = 0.0001 |
| 25 bp | 0.25% |
| 100 bp | 1% |

Exchange fees are expressed in bp per side: 6 bp taker = 0.0006, and a round trip costs two of them. Never confuse "the position lost 2%" (price change) with "2% of capital" (account change, which depends on size).

## Base or quote volume

`volume` can be in units of the asset (base) or in USDT (quote), depending on the source. 1,200 BTC and 1,200 USDT differ by a factor of one hundred thousand. Identify the column (`volume`, `quote_volume`, `base_volume`) and write the unit in your answer. BytNode's candle `volume` is in base units, spot + futures of all venues (`volume_spot`, `volume_futures` split it); its amounts in dollars end in `_usd`. In BytNode's names, `_pct` is a percentage and `_ratio` a fraction (0.585 = 58.5 %).

## Mark, index, last

- **last**: price of the last trade — noisy, manipulable on a thin book.
- **index**: average of several spot markets — the reference.
- **mark**: the price used to compute PnL and **liquidations**, derived from the index.

BytNode's candles take their OHLC from one reference **spot** market: neither a perp's last nor its mark.

A liquidation is triggered on the **mark**, never on the last. A candle low below your stop does not necessarily mean the stop was hit, and vice versa.

## Leverage and liquidation

For a long at leverage `L`, the approximate distance to liquidation is `1/L` (minus maintenance margin): leverage 10 → ~10% drop. A "15% stop" under leverage 10 does not exist: liquidation comes first.

Size is derived from the risk and the distance to the stop, not from the available leverage — see `dimensionnement-et-ruine`.

## Candles and horizons

`1d`, `4h`, `1h`: the number of periods per year changes everything that is annualised.

| Step | Periods/year |
|---|---|
| 1d | 365 (crypto does not close) |
| 4h | 2,190 |
| 1h | 8,760 |

Using 252 (equity trading days) on crypto is a classic error: it underestimates annualised volatility by ~20%.

## Related

- `calcul-verifie`: the conversion formulas.
- `horodatage`: the current candle, time zones.
