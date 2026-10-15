---
name: horodatage
description: Open this before quoting a price, a change or an indicator — what time it really is, why the current candle does not count, and why a price from memory is always wrong
---

# Time, and why you get it wrong

Two errors, systematic:

1. **You have a cutoff date.** The prices, market caps, rates and "latest events" you think you know date from before it. A price from memory is not an approximation: it is a wrong number presented with confidence.
2. **You do not know what time it is.** The user says "today", and you have no clock. You get it from a tool, not by deduction.

## The rule

Every market number comes from a call, in this conversation turn. No price, no change, no level "from memory" — not even for an order of magnitude, not even to illustrate.

Every number carries its **as-of**: the instant at which it was true.

> BTCUSDT — 111,240 USDT (as-of 2026-09-12 08:00 UTC, 4h candle close).

## The current time

```bash
python -c "import datetime; print(datetime.datetime.now(datetime.UTC).isoformat(timespec='seconds'))"
```

Everything in **UTC**. Crypto markets do not close: there is no "closing time" to respect, so no reason to use a local time zone — and two series in two different time zones produce a silent one-candle offset.

## The current candle

The candle in progress is **still forming**: its `close` is the current price, its `high`, its `low` and its `volume` are partial. It will still move. BytNode serves closed candles (`is_closed`) unless you ask `live=true`, which adds the one in progress (`is_closed: false`); an exchange's OHLCV usually ends with it.

- For a calculation (average, indicator, backtest): excluded. An incomplete candle distorts the last point of every indicator.
- For a current price: usable, while saying it is in progress.
- For a "24h" change: say what it covers — last 24 rolling hours, or last closed day.

## Periods

Be explicit, always: "from 2026-08-13 to 2026-09-12 (30 days)", not "over the last month". A month, a quarter, "year to date": these bounds are computed, not estimated.

Beware of partial periods: annualising a performance over eleven days gives a spectacular and meaningless number. State the actual duration next to it.

## What changes fast, what changes slowly

| Data | Validity period |
|---|---|
| Price, order book, current funding | seconds to minutes |
| Open interest, liquidations, sentiment | minutes to hours |
| Daily technical indicators | until the next close |
| Macro releases | until the next release (known calendar) |

If a conversation runs long, a price quoted twenty minutes ago is stale for a decision: recall it or reread it.

## Related

- `calcul-verifie`: how to compute a change without going wrong.
- `citer-ou-se-taire`: the form in which a timestamped number is presented.
