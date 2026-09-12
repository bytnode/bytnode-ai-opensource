---
name: dimensionnement-et-ruine
description: À ouvrir pour fixer une taille de position ou un levier — risque par trade, chaleur totale, corrélation entre positions, distance à la liquidation, et le calcul de risque de ruine
---

# La taille se calcule ; le levier se subit

Tu proposes spontanément « risquer 2 % par trade » ou « levier 5× » comme des conventions. Ce ne sont pas des conventions : ce sont des décisions qui déterminent la survie du compte, et elles dépendent de la distance au stop, de la corrélation entre positions et du taux de réussite réel.

## 1. La taille d'une position

```
taille_notionnelle = capital × risque_par_trade / (distance_au_stop / prix_entree)
```

Le risque par trade est une **fraction du capital**, la distance au stop une **fraction du prix**. Ne confonds jamais les deux : « stop à 5 % » avec « risque 1 % » donne un notionnel de 20 % du capital, pas 1 %.

```python
capital, risque, prix, stop = 10_000, 0.01, 111_240, 106_000
distance = (prix - stop) / prix
notionnel = capital * risque / distance
print(f"distance {100*distance:.2f} % — notionnel {notionnel:,.0f} USDT "
      f"({notionnel/capital:.2f}× capital) — perte au stop {capital*risque:,.0f} USDT")
```

Et la borne : **notionnel ≤ 3 × capital** sauf justification explicite. Au-delà, la liquidation arrive avant le stop.

## 2. La chaleur totale

Le risque du portefeuille n'est pas la somme des risques par trade : des positions corrélées sont **une seule position**. En crypto, la corrélation entre majeures dépasse souvent 0,8 — cinq longs sur cinq actifs différents, c'est un long de taille quintuple.

```python
import pandas as pd
closes = pd.read_csv("data/majeures_1d.csv", parse_dates=["time"]).set_index("time")
r = closes.pct_change().tail(90)
print(r.corr().round(2))
```

Règles de conduite :

- **Chaleur** = somme des risques des positions ouvertes. Plafond : **6 %** du capital.
- Deux actifs de corrélation > 0,7 comptent comme **un seul** dans ce total.
- Un seul groupe corrélé ne dépasse pas 3 % de chaleur.

## 3. La liquidation, avant le stop

Sur perpétuel, la liquidation se déclenche sur le **mark**, à une distance approximative de `1/levier` (moins la marge de maintenance).

| Levier | Distance ~ à la liquidation |
|---|---|
| 3× | 33 % |
| 5× | 20 % |
| 10× | 10 % |
| 20× | 5 % |

**Le stop doit être atteint bien avant la liquidation** : distance au stop ≤ la moitié de la distance à la liquidation. Un stop à 15 % sous levier 10 n'existe pas — le compte est liquidé d'abord.

## 4. Le risque de ruine

À taux de réussite `p`, ratio gain/perte `b` et risque `f` par trade, la probabilité de perdre une fraction du capital se simule. Ne l'estime pas : calcule-la.

```python
import numpy as np
rng = np.random.default_rng(0)
p, b, f, n, sims = 0.40, 2.5, 0.01, 200, 20_000
gains = np.where(rng.random((sims, n)) < p, f * b, -f)
equity = np.cumprod(1 + gains, axis=1)
dd = (equity / np.maximum.accumulate(equity, axis=1) - 1).min(axis=1)
print(f"perte finale > 20 % : {(equity[:, -1] < 0.8).mean():.1%}")
print(f"drawdown médian {np.median(dd):.1%} — pire décile {np.quantile(dd, 0.1):.1%}")
```

Sers-toi de la sortie pour choisir `f`, et donne-la à l'utilisateur : c'est le chiffre qui compte pour lui, plus que le rendement annualisé.

**La fraction de Kelly** (`f* = p - (1-p)/b`) est le maximum de croissance, pas une recommandation : elle produit des drawdowns intolérables. La pratique est **un quart à une demie de Kelly**, et jamais au-delà de 2 % par trade avec un taux de réussite estimé sur moins de 100 trades.

## 5. Ce qui doit apparaître dans toute proposition

> **Dimensionnement** : risque 1 % par trade, stop à 2×ATR (≈ 4,7 % du prix) → notionnel ≈ 2,1× capital, levier effectif 2,1× (liquidation à ~45 %, stop à 4,7 % : marge suffisante). Chaleur maximale 4 % sur deux positions corrélées à 0,82, comptées comme une. Simulation sur 200 trades (p = 0,40, b = 2,5) : drawdown médian −11 %, pire décile −24 %, probabilité de perdre plus de 20 % du capital : 9 %.

## Lié

- `gestion-risque` : la démarche d'ensemble.
- `conventions-marche` : mark, liquidation, levier.
- `budget-de-cout` : le coût entre dans l'avantage net avant tout dimensionnement.
