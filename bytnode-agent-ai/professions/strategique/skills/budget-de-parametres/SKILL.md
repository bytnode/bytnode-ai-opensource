---
name: budget-de-parametres
description: À ouvrir quand une stratégie accumule des conditions — comment compter les paramètres, le plafond à respecter, et la procédure pour retirer une règle plutôt qu'en ajouter une
---

# Chaque condition ajoutée est une chance de te tromper

Ton réflexe, quand une stratégie donne un résultat moyen, est d'**ajouter** : un filtre RSI, une condition de volume, un seuil horaire, une exception les week-ends. Le backtest s'améliore à chaque ajout — c'est précisément le symptôme. Tu n'améliores pas la stratégie, tu la moules sur le passé.

**Règle : quatre paramètres au maximum. Chacun est justifié par une raison de marché, pas par son effet sur le résultat.**

## Ce qui compte comme paramètre

Tout nombre que tu pourrais changer : longueurs de moyennes, seuils d'indicateurs, multiplicateurs de stop, durée maximale de position, heures de la journée, plafonds de volatilité.

```
close > MM200          →  1 paramètre (200)
MM20 > MM50            →  2 (20, 50)
RSI(14) < 30           →  2 (14, 30)
stop 2 × ATR(14)       →  2 (2, 14)
volume > 1,5 × MM20    →  2 (1,5, 20)
                          ─────────────
                          9 paramètres → refusé
```

Ne comptent pas : le pas de temps, l'univers, le risque par trade (fixés par le cadre, pas optimisés).

## Le plafond, et pourquoi

Avec `k` paramètres essayés sur `T` années de données, le meilleur Sharpe trouvé est gonflé d'environ `sqrt(2 ln K / T)` où `K` est le nombre de combinaisons explorées. Trois paramètres à dix valeurs chacun : K = 1 000, soit sur 3 ans un gonflement de ~+1,5 de Sharpe **sur du bruit pur**. C'est plus que l'avantage de la plupart des vraies stratégies.

| Paramètres | Ce que ça exige |
|---|---|
| 1 à 2 | idéal — testable honnêtement |
| 3 à 4 | acceptable, chacun justifié à l'écrit |
| 5 et plus | refusé : commence par retirer |

## La procédure quand le résultat déçoit

Dans cet ordre, jamais l'inverse :

1. **Retire** la condition la moins justifiée et re-teste. Si le résultat ne bouge presque pas, elle ne servait à rien : elle reste dehors.
2. **Vérifie les coûts** (`budget-de-cout`) : le problème est souvent là, pas dans le signal.
3. **Change de pas de temps ou d'univers** — c'est un changement d'hypothèse, pas un paramètre en plus.
4. **Abandonne.** Une stratégie sans avantage n'en acquiert pas par accumulation de filtres. L'abandonner est un résultat, pas un échec.

## Le test du plateau

Un paramètre acceptable a un **plateau** : les valeurs voisines donnent des résultats voisins. Un pic isolé est du bruit.

```
Backtest(..., params={"slow": 40})   # puis 32, 36, 44, 48
```

Retiens une valeur **au milieu du plateau**, pas au sommet. Si aucun plateau n'apparaît, le paramètre n'a pas de sens : retire la règle.

## À écrire dans la proposition

> **Paramètres** : 3 — MM200 (régime : filtre de tendance longue, valeur standard, plateau 150-250), MM20/MM50 (croisement : plateau 15-25 / 40-60), 2×ATR14 (stop : plateau 1,5-2,5). Variantes explorées : K ≈ 60. Aucun filtre de volume ni d'horaire : testés, sans effet hors bruit, retirés.

Déclarer K honnêtement est ce qui permet à `validation-statistique` de déflater le Sharpe. Ne pas le déclarer, c'est le cacher.

## Lié

- `specification-executable` : où les paramètres se déclarent.
- `validation-statistique` (métier Quantitatif) : la correction pour tests multiples.
- `hypothese-de-regime` : un filtre de régime est une hypothèse, pas un paramètre d'ajustement.
