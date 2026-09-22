---
name: trade-review
description: Open this to analyse open positions or a trade history on an exchange account — the readings to take, the alert thresholds (liquidation, funding, concentration), the review template, and how to chart the history
---

# Reviewing positions and trades

Analysing commits nothing: the read-only tools ask no permission. But a review that misses a liquidation at 4% or announces a PnL from the top of your head is worthless. The method:

## Open positions

1. `ExchangePositions` (account, optionally `symbol`): side, size, entry, mark, unrealised PnL, leverage, liquidation.
2. `ExchangeTicker` with `market: futures` on each pair: current funding and next funding — a long pays positive funding, a short receives it.
3. `ExchangeBalance` with `market: futures`: free margin is the distance to the first margin call across the whole account.

**Thresholds to flag unprompted** (at the top of the answer, not in a footnote):
- distance to liquidation **< 10%**: alert; **< 5%**: urgent, propose a partial `ClosePosition` or a margin top-up (`Transfer` spot → futures) — the user decides;
- annualised funding higher than the expected unrealised gain;
- one pair weighing more than half of the account's notional exposure;
- a position with no protective order pending (`ExchangeOrders status: open`, look for a `stop` opposite to the side).

To **follow** a position for a few minutes: `ExchangeWatch` with `until` (`liq<5%`, `pnl<-50`, `price>=…`). It stops by itself after 10 minutes; relaunch it if the user wants to continue.

## History

1. `ExchangeOrders` with `status: "closed"`, one pair at a time if the exchange requires it, `since` for the period, `limit` up to 200.
2. For more than a few dozen rows, write them to a CSV in the workspace (`Write`, columns `date,symbol,side,type,amount,price,average,filled,fee,fee_currency,status`) then `Chart` to plot (cumulative PnL curve, distribution of fills).
3. The metrics, all **computed by executing** (skill `calcul-verifie`): realised PnL by period and by pair, total fees, number of trades, win rate, average win / average loss, largest loss, drawdown of the cumulative curve.

## Review template

```
Account: <label> (<exchange>, LIVE | testnet) — <reading date/time>

Alerts: <what exceeds a threshold, or "none">

Positions
<pair> · <LONG/SHORT size> · entry <p> · mark <p> · PnL <±x (±y%)> · ×<leverage> · liquidation <p> (<d%>) · funding <r%> (next <time>)

Free margin: <x USDT> · Notional exposure: <x USDT> (<pair> = <y%>)

History <period>
<n> trades · realised PnL <±x> · fees <x> · win rate <y%> · worst trade <±x> · drawdown <x%>
[chart]

Reading: <three sentences at most — what is fine, what is worrying, what you propose; the decisions are the user's>
```

One number = one tool reading or one executed calculation. If a piece of data is missing (the exchange does not publish the liquidation, the history is truncated), say so instead of filling it in.
