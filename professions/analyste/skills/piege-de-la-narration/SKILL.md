---
name: piege-de-la-narration
description: Open this before explaining a price move — how to check that there is something to explain, produce the competing explanation, and not turn a coincidence into a cause
---

# You manufacture causes

This is your most useful weakness to know: give me any price move and a list of news items, and I will produce a coherent explanation — in both directions. "BTC falls **because** rates are rising" and "BTC rises **despite** rising rates" write equally well. This facility is not analysis: it is narration, and it gives the user a false impression of understanding.

Three guardrails, in order.

## 1. Is there something to explain?

Before any cause, measure the abnormality of the move. A −3% on an asset whose daily standard deviation is 3% is noise: it has no identifiable cause, and looking for one is the error.

```python
import pandas as pd
df = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time")
r = df["close"].pct_change()
z = (r.iloc[-1] - r.tail(90).mean()) / r.tail(90).std()
print(f"variation {100*r.iloc[-1]:.2f} % — z = {z:.2f} sur 90 j")
```

| |z| | What you write |
|---|---|
| < 1 | "within usual volatility" — no causal explanation |
| 1 to 2 | "notable but not exceptional move" — hypotheses in the conditional |
| > 2 | "abnormal move" — there, search, and count how many times it happened over a year |

## 2. The competing explanation

When you put forward a cause, you put forward **two**, and you say how one tells them apart through an observation.

> The rise comes with high volume. Two readings: accumulation (buyers absorb the supply) or distribution (sellers unload into strength). One tells them apart through funding and open interest: accumulation leaves funding neutral and OI rising; distribution shows as funding that runs hot then falls back.

Three candidates never to forget, because they explain the majority of moves without any news:

- **Mechanical flow**: cascading liquidations, options expiry, rebalancing.
- **Correlation**: the asset follows BTC, or BTC follows tech equities. Check it before inventing a cause of its own.
- **Nothing**: liquidity was thin (weekend, off-hours), a medium-sized order was enough.

## 3. What forbids saying "because of"

- **Chronological order is not proof.** If the news came out *after* the move, it does not explain it. Compare the timestamps, to the minute (`horodatage`).
- **A single precedent is not a regularity.** "The last time funding was at this level, the price dropped": how many times did funding reach this level over two years, and in what proportion of cases did the price drop? See `taux-de-base`.
- **A correlation is quantified.** If you invoke a link with rates, gold or the Nasdaq, give the coefficient and the window — otherwise it is an impression.

## The form

> **Fact**: ETHUSDT −4.8% in 24h (as-of …). z = −2.3 over 90d: abnormal, happened 6 times in a year.
> **Main reading**: … because … — what supports it: …
> **Competing reading**: … — what would tell it apart: …
> **What does not explain it**: the 14:30 release, which came after the move.
> **Uncertainty**: high, the sample is 6 cases.

## Related

- `taux-de-base`: the historical frequency before the interpretation.
- `fenetre-honnete`: not choosing the convenient horizon.
- `contradiction-obligatoire`: the same discipline applied to the user's thesis.
