---
name: analyse-tendance
description: Establish an asset's trend over three horizons from BytNode series — price structure, derivatives, on-chain — and derive conditional scenarios from it
---

# Trend analysis

## The data

For the asset, candles from `get_market_data` (`klines` with `since_ms` / `until_ms` and the `timeframe`; through `SaveMarketData` when it is more than a few dozen rows):
- **Daily over 180 days** — the long horizon.
- **4 hours over 30 days** — the medium horizon.
- **1 hour over 5 days** — the short horizon.
If the plan's history depth refuses a horizon, the error says so: work with what is served and say it.
Plus, as a current value and as a recent series: `funding_rate` / `funding_next`, `oi`, `liquidations_cumulative` (derivatives); `cvd`, `buy_sell_ratio` (order flow); for BTC `btc_mvrv`, `btc_nvt`, `btc_active_addresses`, for ETH `eth_supply`, `eth_staking` (on-chain); `options_iv` (BTC, ETH); indicators from `get_market_indicators` (20/50/200 moving averages, ATR, RSI) rather than recomputed.

## Per horizon: four questions

1. **Structure** — is the price making higher highs and higher lows (uptrend), lower ones (downtrend), or moving within a band (range)? Give the levels: last high, last low, range bounds.
2. **Position** — where is the price relative to the 20/50/200 moving averages and to the range? As a percentile of the 180d range if possible.
3. **Impulse** — is volatility (ATR) rising or falling? Does volume accompany the moves in the direction of the trend?
4. **Participation** — is open interest rising with price (trend fuelled) or against it (counter-trend positions, fragility)? Is funding neutral, leaning, extreme? Are the recent liquidations longs or shorts?

## The synthesis

A horizon × verdict table:

| Horizon | Structure | Position | Impulse | Participation | Verdict |
|---|---|---|---|---|---|
| Long (1d, 180d) | … | … | … | … | bullish / bearish / range |
| Medium (4h, 30d) | … | | | | |
| Short (1h, 5d) | … | | | | |

Then:
- **Alignment**: do the three horizons go in the same direction? A short against the long is a correction until the medium flips.
- **Divergences**: price rising with OI falling (covering, no fresh buying); price at a new high with a lower RSI; extreme funding against the move.
- **On-chain**: valuation zone (MVRV, NVT), network activity (active addresses), for ETH net issuance and staking. Exchange flows are not in BytNode: if they matter, a dated web source.

## The scenarios

Two or three, never a single one:
- **Scenario**: condition ("if the price holds above X and OI keeps rising") → expected development → **invalidation** ("below Y on a daily close").
- Qualitative probability justified by the number of confirmations.
- What one would need to see in the next 24–72h to decide between them.

## What invalidates the analysis itself

Data too short, illiquid asset (low volumes make the structure noisy), imminent macro event that makes the short term random. Say so.
