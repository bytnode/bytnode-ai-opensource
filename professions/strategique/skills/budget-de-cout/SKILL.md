---
name: budget-de-cout
description: Open this before proposing a strategy — quantify fees, slippage and funding per round trip, compare them to the expected edge, and refuse what does not clear the threshold
---

# Most proposed strategies die on costs

This is the most frequent and most silent error: a rule that wins 0.15% per trade, with 0.22% of frictions per round trip, loses money — and nothing in the reasoning flags it. The shorter the timeframe, the truer this is.

**Rule: the cost budget is computed before the first backtest, and the strategy is refused if the expected gross edge does not reach twice the cost.**

## The calculation

```python
FEE = 0.0006        # taker, per side — real value of the targeted exchange
SLIP = 0.0005       # per side; more on altcoins or under stress
FUNDING = 0.0001    # per 8h period, recent average (sign depending on direction)

duree_h = 48        # targeted average position duration
aller_retour = 2 * (FEE + SLIP)
cout_funding = FUNDING * (duree_h / 8)
cout_total = aller_retour + cout_funding
print(f"coût par trade : {100*cout_total:.3f} % "
      f"(frictions {100*aller_retour:.3f} % + funding {100*cout_funding:.3f} %)")
```

Then, opposite it, the expected gross edge per trade — **estimated before the test**, from the targeted amplitude and the hoped-for win rate:

```python
taux_reussite, gain_moyen, perte_moyenne = 0.40, 0.030, 0.012   # as fractions
avantage = taux_reussite * gain_moyen - (1 - taux_reussite) * perte_moyenne
print(f"avantage brut : {100*avantage:.3f} % — ratio avantage/coût : {avantage/cout_total:.1f}×")
```

| Edge / cost ratio | Verdict |
|---|---|
| < 1 | losing by construction — we stop here |
| 1 to 2 | too fragile: a rise in slippage kills it. To refuse unless there is a strong argument |
| 2 to 4 | viable, to be tested |
| > 10 | suspect: check the amplitude assumption, it is probably too optimistic |

## What is systematically forgotten

- **Funding on held positions.** At 0.01% / 8h, a 5-day position costs 0.15% — often more than fees. On a short, positive funding **pays** you: the sign matters.
- **Real slippage, not theoretical.** It depends on size relative to the order book, and it explodes at the precise moment the strategy wants to act (volatility, liquidations). Double it for a robustness test.
- **Stops are market orders.** A hit stop pays slippage, often worse than average.
- **Frequency.** A strategy that trades 300 times a year pays 300 round trips: at 0.22%, that is 66% of capital consumed in frictions. The number of trades is a design parameter, not a consequence.
- **Altcoins.** On the less liquid pairs of the scope, take double the frictions of BTC.

## The mandatory sensitivity test

After the backtest, rerun with **double the fees and slippage**. If the result flips, the strategy is not viable — it lived off the cost assumption.

```
Backtest(..., fee=0.0006, slippage=0.0005)   # reference
Backtest(..., fee=0.0012, slippage=0.0010)   # stress
```

Both tables go into the report, side by side.

## The form in the proposal

> **Cost budget**: 0.22% of frictions per round trip + 0.06% of funding (48h at 0.01%/8h) = **0.28% per trade**. Estimated gross edge: 0.77% (40% win rate, +3.0% / −1.2%). Ratio 2.8× — viable, to be tested. Under stress (fees and slippage doubled), the ratio drops to 1.5×: the margin is thin, frequency will have to stay low.

## Related

- `conventions-marche`: funding, bp, mark and liquidation.
- `specification-executable`: costs are a field of the specification.
- `plan-backtest`: where the stress test sits.
