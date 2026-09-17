---
name: hypothese-de-regime
description: À ouvrir en concevant une stratégie — nommer le régime de marché dans lequel elle est censée gagner, écrire le filtre qui le détecte, et mesurer sa performance régime par régime
---

# Une stratégie gagne dans un régime, pas « en général »

Aucune règle ne gagne partout : le suivi de tendance perd en range, le retour à la moyenne se fait balayer en tendance, la vente de volatilité gagne quatre-vingt-dix fois puis rend tout. Ton défaut est de proposer des stratégies **sans nommer leur régime**, donc sans filtre pour l'éviter et sans savoir quand elles vont échouer.

**Règle : la stratégie déclare son régime, le filtre qui le détecte, et sa performance mesurée dans chaque régime — pas seulement en moyenne.**

## Les régimes, définis à l'avance

Définis-les **avant** de regarder les résultats, avec des règles causales (données ≤ t).

```python
import pandas as pd
df = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time").sort_index()
c = df["close"]
mm200 = c.rolling(200).mean()
pente = mm200.pct_change(20)                                  # inclinaison sur 20 j
atr = (df["high"] - df["low"]).rolling(14).mean() / c         # volatilité relative

regime = pd.Series("range", index=c.index)
regime[(c > mm200) & (pente > 0.01)] = "haussier"
regime[(c < mm200) & (pente < -0.01)] = "baissier"
df["vol"] = pd.cut(atr, [0, 0.02, 0.05, 1], labels=["calme", "normale", "extreme"])
print(pd.crosstab(regime, df["vol"], normalize="all").round(3))
```

Quatre familles suffisent : **haussier**, **baissier**, **range**, et en travers **volatilité calme / normale / extrême**.

## Le tableau qui doit accompagner tout backtest

| Régime | Part du temps | Rendement | Sharpe | DD max | Trades |
|---|---:|---:|---:|---:|---:|
| haussier | 38 % | … | … | … | … |
| baissier | 24 % | … | … | … | … |
| range | 38 % | … | … | … | … |
| vol. extrême | 9 % | … | … | … | … |

Sa lecture :

- **Gagne partout** : méfiance. Regarde la fuite de données (`anti-fuite`) avant de te réjouir.
- **Gagne dans un régime, neutre ailleurs** : c'est le bon cas — le filtre de régime devient une règle de la stratégie.
- **Gagne dans un régime, perd lourdement dans un autre** : la stratégie n'est validée que si le filtre détecte le régime **en temps réel**, sans connaître la suite.
- **Le régime gagnant représente 10 % du temps** : la stratégie est rare. Dis combien de trades par an cela laisse, et si l'échantillon permet de conclure.

## Le piège du filtre rétrospectif

Un filtre de régime qui utilise l'avenir n'est pas un filtre : c'est une triche. « Ne trader que dans les phases haussières » est valide si la phase se détecte avec `close > MM200` à l'instant t ; c'est faux si la phase est nommée après coup en regardant le graphique.

Vérifie-le : le filtre doit se calculer dans `signal(df)` comme le reste, sans `shift(-1)`, sans `center=True`.

## Le changement de régime coûte cher

Les transitions sont là où les stratégies perdent : le suivi de tendance donne ses pires trades au retournement. Deux conséquences à écrire :

- Le **délai du filtre** : une MM200 tourne avec plusieurs semaines de retard. Dis-le, et mesure le coût de ce retard (performance des 10 bougies qui suivent chaque bascule).
- Le **garde-fou de volatilité extrême** : réduire la taille ou ne pas trader quand `ATR/close` dépasse son 90ᵉ percentile. C'est souvent l'ajout le plus rentable de toute la stratégie — et il ne coûte qu'un paramètre.

## À écrire dans la proposition

> **Hypothèse de régime** : suivi de tendance, gagne en marché directionnel (haussier ou baissier prolongé), perd en range. Détection : `close` du côté de la MM200 et pente de MM200 sur 20 j au-delà de ±1 %. Sur 2022-2026, le régime directionnel couvre 62 % du temps. Hors régime, la stratégie ne prend pas de position. Garde-fou : pas d'entrée si ATR14/close > 6 % (9 % du temps). Coût du retard de détection : les 10 bougies suivant une bascule sont négatives en moyenne de −0,4 %.

## Lié

- `specification-executable` : le filtre de régime est un champ obligatoire.
- `budget-de-parametres` : le filtre ne doit pas devenir un prétexte à ajuster.
- `validation-statistique` (métier Quantitatif) : mesurer par régime fait partie du protocole.
