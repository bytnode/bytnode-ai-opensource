---
name: trading-execution
description: Open this before placing, modifying or cancelling an order on an exchange account — the six-step method (balance, price, size, order, confirmation, report), the quote → base conversion, and what we never do
---

# Placing an order properly

An order commits money, sometimes real. The method below is not red tape: it is what avoids the order ten times too large, the pair that does not exist on this exchange, or the second order placed because the first one "did not look" filled.

## First of all: which account, which market

- If there are several accounts, **name `account`** on every call. Do not guess.
- A **LIVE** account commits real money; a **testnet** does not. Tell the user in your answer, without making them guess.
- `market: futures` for a perpetual; otherwise it is spot. A position, a leverage, a `reduceOnly` only make sense in futures.

## The six steps

1. **Balance** — `ExchangeBalance` on the targeted account and market. How much quote currency is free? In futures, free margin is what counts.
2. **Price** — `ExchangeTicker` on the pair, **on this exchange** (BytNode gives the market in general; the exchange gives the order book that will execute). Note `last`, `bid`, `ask`, and the spread.
3. **Size** — the order is placed in **base** asset (`amount`, in BTC), not in quote currency. Two ways:
   - you give `quoteAmount` ("200 USDT") and the tool converts at the order's own price — the limit price for `limit` / `stop_limit`, the `stopPrice` for `stop` / `take_profit`, the last price for `market`;
   - you compute `amount = quote_amount / price` with an **executed** calculation (skill `calcul-verifie`), never in your head.
   The tool rounds to the market's precision and refuses below the minimum: read its message.
   **Contracts.** On some futures markets (OKX, Gate, KuCoin, HTX) the exchange counts in contracts, and one contract is a fraction of the asset (OKX BTC: 0.01 BTC). Always give `amount` in the **asset** (BTC): the tool converts to contracts itself and its answer says both ("0.1 BTC (10 contracts)"). Never pass a number of contracts as `amount`.
   When your tools include **PositionSize** (the Position calculator), size the order with it — from the capital and the risk the user accepts, with the stop — rather than from a round amount; before a leveraged order, **LiquidationPrice** says where the position would be liquidated (an estimate: say so), and **RiskReward** whether the targets are worth the stop.
4. **Order** — `PlaceOrder`. `market` to execute now; `limit` with `price` to wait for a price; `stop` / `stop_limit` / `take_profit` with `stopPrice` for a trigger. In futures: `reduceOnly: true` for any order that must **exit** a position, never to enter one.
   **The user authorises each order.** Wait for the tool's result; a refusal is not an error to work around, it is a decision.
5. **Confirmation** — `ExchangeOrders` with `status: "open"` (the order is waiting) or `"closed"` (it went through: average price, fees). Never conclude on the `PlaceOrder` response alone if it says `open` or `pending`.
   **Outcome UNKNOWN.** If `PlaceOrder`, `ClosePosition` or `Transfer` answers "Outcome UNKNOWN" (a timeout, a lost connection), the exchange may have executed it — the tools never re-send an action on their own. **Do not send it again.** First check: `ExchangeOrders` `open` then `closed` on the pair and look for the **client id** the message gives (it appears as `(client id bnai…)` on the order's line), `ExchangePositions` for a close, `ExchangeBalance` on both wallets for a transfer. Only if nothing shows, tell the user and ask before placing it again.
6. **Report** — what was placed (pair, side, quantity, type, price), what was executed (average, fees), the balance or the position afterwards. One number = one tool reading.

## What we never do

- Two orders without having read the result of the first.
- Re-send an order, a close or a transfer whose outcome is unknown before checking that it did not go through.
- An order "to see" on a LIVE account.
- Convert quote → base in your head.
- Assume a `limit` order is filled because it was accepted.
- Insist after a refusal from the user.
- Try to withdraw funds to an address: the tool does not exist, and it never will; `Transfer` only moves spot ↔ futures within the same account.

## Cancelling, adjusting

- `CancelOrder` with the `orderId` read in `ExchangeOrders`; `all: true` + `symbol` to clear a pair.
- To move a limit order: cancel, then place again. There is no "modification".
- `SetLeverage` **before** the entry order, never on an open position without having told the user (the required margin changes).
