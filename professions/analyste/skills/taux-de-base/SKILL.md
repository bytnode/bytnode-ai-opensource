---
name: taux-de-base
description: Open this before saying that a level is high, rare or extreme — how to measure the historical frequency of a fact instead of reasoning by salience, and write it as a percentile
---

# "Rare" is measured, not felt

You reason by salience: what is striking seems significant to you. A funding at 0.05%, a fear reading at 18, a volume double the day before — you call them extreme because they sound extreme, without knowing whether that happens once a year or three times a month. An analyst, by contrast, knows the **base rate** before interpreting.

**Rule: every adjective of rarity (high, low, extreme, unusual) is accompanied by a percentile and an occurrence count.**

## The measurement

```python
import pandas as pd
s = pd.read_csv("data/btc_funding.csv", parse_dates=["time"]).set_index("time").sort_index()["rate_pct"]  # BytNode funding_rate: % per 8h
x = s.iloc[-1]
pct = (s < x).mean()
n = (s.tail(365) >= x).sum()
print(f"valeur {x:.4f} % — percentile {100*pct:.0f} %, atteinte {n} fois sur les 365 dernières observations")
```

What gets written:

> Funding at 0.043% / 8h: 96th percentile over two years, reached 14 times in one year. High, but not unprecedented.

## What comes next: so what?

A percentile alone says nothing about what follows. The step that is almost always missing: **what happened afterwards, the previous times?**

```python
seuil = x
dates = s[s >= seuil].index
c = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time")["close"]
apres = [c.asof(d + pd.Timedelta("7D")) / c.asof(d) - 1 for d in dates]
apres = pd.Series(apres).dropna()
print(f"{len(apres)} cas — médiane à 7 j : {100*apres.median():+.2f} %, "
      f"{100*(apres > 0).mean():.0f} % de hausses")
```

And the sentence that goes with it, with its caveat:

> Over the 14 comparable cases, the 7-day median is −1.8%, with 5 rises out of 14. Thin sample: indicative, not predictive.

Below **30 cases**, say so explicitly. Below 10, do not give a median: describe the cases.

## Useful references to keep in mind

To avoid starting from scratch every time (to be checked on the data, these are orders of magnitude):

| Fact | Typical frequency in a major crypto |
|---|---|
| ±3% day | common — several times a month |
| ±10% day | a few times a year |
| 20% drawdown | at least once a year |
| 50% drawdown | once per cycle |
| Negative funding several days in a row | a few episodes a year |

A statement that contradicts these orders of magnitude requires verification before being written.

## The symmetric trap

Do not conclude either that a rare fact is **important**. Rare and inconsequential is frequent: rarity measures the unusual, not the impact. The two questions are distinct, and you answer both.

## Related

- `fenetre-honnete`: over which period to measure.
- `scenarios-calibres`: turning these frequencies into owned probabilities.
- `validation-statistique` (Quantitative profession): when the sample becomes proof.
