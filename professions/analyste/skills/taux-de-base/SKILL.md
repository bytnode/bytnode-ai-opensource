---
name: taux-de-base
description: À ouvrir avant de dire qu'un niveau est élevé, rare ou extrême — comment mesurer la fréquence historique d'un fait au lieu de raisonner par saillance, et l'écrire sous forme de percentile
---

# « Rare » se mesure, ne se ressent pas

Tu raisonnes par saillance : ce qui est frappant te paraît significatif. Un funding à 0,05 %, une peur à 18, un volume double de la veille — tu les qualifies d'extrêmes parce qu'ils sonnent extrêmes, sans savoir si cela arrive une fois par an ou trois fois par mois. Un analyste, lui, connaît la **fréquence de base** avant d'interpréter.

**Règle : tout adjectif de rareté (élevé, faible, extrême, inhabituel) est accompagné d'un percentile et d'un compte d'occurrences.**

## La mesure

```python
import pandas as pd
s = pd.read_csv("data/btc_funding.csv", parse_dates=["time"]).set_index("time")["funding"]
x = s.iloc[-1]
pct = (s < x).mean()
n = (s.tail(365) >= x).sum()
print(f"valeur {x:.5f} — percentile {100*pct:.0f} %, atteinte {n} fois sur les 365 dernières observations")
```

Ce qui s'écrit :

> Funding à 0,043 % / 8 h : 96ᵉ percentile sur deux ans, atteint 14 fois en un an. Élevé, mais pas inédit.

## Ce qui vient ensuite : et alors ?

Un percentile seul ne dit rien de la suite. Le pas qui manque presque toujours : **que s'est-il passé après, les fois précédentes ?**

```python
seuil = x
dates = s[s >= seuil].index
c = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time")["close"]
apres = [c.asof(d + pd.Timedelta("7D")) / c.asof(d) - 1 for d in dates]
apres = pd.Series(apres).dropna()
print(f"{len(apres)} cas — médiane à 7 j : {100*apres.median():+.2f} %, "
      f"{100*(apres > 0).mean():.0f} % de hausses")
```

Et la phrase qui va avec, avec sa réserve :

> Sur les 14 cas comparables, la médiane à 7 jours est de −1,8 %, avec 5 hausses sur 14. Échantillon mince : indicatif, pas prédictif.

Sous **30 cas**, dis-le explicitement. Sous 10, ne donne pas de médiane : décris les cas.

## Les références utiles à avoir en tête

Pour éviter de partir de zéro à chaque fois (à vérifier sur les données, ce sont des ordres de grandeur) :

| Fait | Fréquence typique en crypto majeure |
|---|---|
| Journée à ±3 % | courant — plusieurs fois par mois |
| Journée à ±10 % | quelques fois par an |
| Drawdown de 20 % | au moins une fois par an |
| Drawdown de 50 % | une fois par cycle |
| Funding négatif plusieurs jours de suite | quelques épisodes par an |

Une affirmation qui contredit ces ordres de grandeur exige une vérification avant d'être écrite.

## Le piège symétrique

Ne conclus pas non plus qu'un fait rare est **important**. Rare et sans conséquence est fréquent : la rareté mesure l'inhabituel, pas la portée. Les deux questions sont distinctes, et tu réponds aux deux.

## Lié

- `fenetre-honnete` : sur quelle période mesurer.
- `scenarios-calibres` : transformer ces fréquences en probabilités assumées.
- `validation-statistique` (métier Quantitatif) : quand l'échantillon devient une preuve.
