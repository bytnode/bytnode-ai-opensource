---
name: contexte-macro
description: Read the macroeconomic context that weighs on risk assets and relate it to the crypto market — rates, dollar, liquidity, risk appetite, calendar
---

# Macro context

Crypto is a high-beta risk asset: it amplifies what global liquidity does. An analysis that ignores macro describes the wave without seeing the tide.

## The grid

For each factor: the current value, its recent direction, and what it does to risk assets *right now* (the relationship can reverse: check over the last 3 months with BytNode — `get_market_data` with `since_ms` on `macro` (FRED series), `macro_intraday` (DXY, US 10Y, VIX, S&P 500, Nasdaq…) or `macro_net_liquidity`; the series are listed by `get_system_info(catalogs=["macro_series", "macro_intraday_series"])` — otherwise WebSearch, official sources first — central banks, statistical offices, reference financial press).

| Factor | What we look at | Usual reading |
|---|---|---|
| Monetary policy | Fed/ECB policy rates, cut/hike expectations (futures), next FOMC | Cut expectations = support for risk; hawkish surprise = withdrawal |
| Real rates | US 10-year yield minus expected inflation | Rising reals = pressure on non-yielding assets (gold, crypto) |
| Dollar | DXY, 1–3 month trend | Strong dollar = headwind for crypto, historically |
| Liquidity | Central bank balance sheets, bank reserves, financial conditions | Expanding liquidity = supportive ground |
| Risk appetite | Nasdaq, small caps, high-yield credit spreads, VIX | Risk-on/risk-off; crypto follows the Nasdaq with a beta > 1 |
| Gold | Trend, recent correlation with BTC | When both rise: "debasement" narrative; when they diverge: crypto behaves as a risk asset, not a haven |
| Crypto-specific flows | Spot ETF flows (web; BytNode's `etf_fundamentals` gives the quarterly holdings per issuer), stablecoins issued/redeemed | Sustained inflows = structural demand |

## The calendar

List the events of the next 7 days that can move the market: FOMC, CPI/PCE, US employment, ECB decisions, crypto options expiries (month-end, quarter-end), token unlocks, regulatory decisions. An event less than 48h away makes any short-term reading conditional: say so.

## The synthesis

Three lines:
- **Regime**: supportive / neutral / hostile for risk, and the dominant factor.
- **What has changed** recently (two weeks).
- **The tipping risk**: which event or which threshold (e.g. 10-year above X%, DXY above Y) would change the regime.

Then explicitly link to the crypto market: "in this regime, a BTC rebound without an improvement in ETF flows would be fragile" — one linking sentence, not a theory.

## Rules

- Every macro number has its date and its source (organisation, page).
- Correlations are verified, not assumed: give the observation period.
- No macro prediction; scenarios ("if the Fed cuts in X, then…") with what invalidates them.
