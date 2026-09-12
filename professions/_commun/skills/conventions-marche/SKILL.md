---
name: conventions-marche
description: À ouvrir quand une donnée porte une unité ou une convention de marché — funding, perpétuel contre spot, points de base, volume base ou quote, mark contre index, liquidation — pour ne pas lire un chiffre juste de travers
---

# Lire un chiffre de marché sans le déformer

Ces erreurs ne sont pas des erreurs de raisonnement : ce sont des unités mal lues. Elles produisent des conclusions fausses d'un facteur 3, 100 ou 1 000, sans que rien n'ait l'air anormal.

## Perpétuel, spot, future

BytNode couvre des **perpétuels marginés en USDT** (`BTCUSDT`, `ETHUSDT`…). Un perpétuel n'a pas d'échéance : il reste collé au spot par le **funding**, payé entre longs et shorts.

- Le prix d'un perp n'est pas le prix spot. L'écart s'appelle la **base** : `(perp / spot - 1)`.
- `USDCUSDT` et `USDTUSDC` sont des paires de stablecoins : une variation de 0,2 % y est un événement, pas du bruit. Ne les compare pas à du BTC.
- Un « volume » de perp est du notionnel échangé, pas une quantité de coins détenus. Il ne dit rien de l'adoption.

## Funding

Publié **par période de financement** (8 h en général), en fraction ou en pourcentage — vérifie lequel.

```
funding 0,01 % / 8 h  →  0,03 % / jour  →  ~10,95 % / an
annualisé = f * 3 * 365
```

- Signe positif : les longs paient les shorts (marché penché long). Négatif : l'inverse.
- Sur une position tenue plusieurs jours, le funding est souvent le premier poste de coût — davantage que les frais. Il entre dans `budget-de-cout`.
- Un funding extrême est un indicateur de positionnement, pas une prévision de direction.

## Pourcentages et points de base

| Écriture | Valeur |
|---|---|
| 1 bp | 0,01 % = 0,0001 |
| 25 bp | 0,25 % |
| 100 bp | 1 % |

Les frais d'échange s'expriment en bp par côté : 6 bp taker = 0,0006, et un aller-retour en coûte deux. Ne confonds jamais « la position a perdu 2 % » (variation de prix) et « 2 % du capital » (variation du compte, qui dépend de la taille).

## Volume base ou quote

`volume` peut être en unités de l'actif (base) ou en USDT (quote), selon la source. 1 200 BTC et 1 200 USDT diffèrent d'un facteur cent mille. Repère la colonne (`volume`, `quote_volume`, `base_volume`) et écris l'unité dans ta réponse.

## Mark, index, last

- **last** : prix de la dernière transaction — bruité, manipulable sur un carnet mince.
- **index** : moyenne de plusieurs marchés spot — la référence.
- **mark** : le prix qui sert au calcul du PnL et des **liquidations**, dérivé de l'index.

Une liquidation se déclenche sur le **mark**, jamais sur le last. Un plus-bas de bougie en dessous de ton stop ne signifie pas forcément que le stop a été touché, et inversement.

## Levier et liquidation

Pour un long à levier `L`, la distance approximative à la liquidation est `1/L` (moins la marge de maintenance) : levier 10 → ~10 % de baisse. Un « stop à 15 % » sous levier 10 n'existe pas : la liquidation arrive avant.

La taille se déduit du risque et de la distance au stop, pas du levier disponible — voir `dimensionnement-et-ruine`.

## Bougies et horizons

`1 j`, `4 h`, `1 h` : le nombre de périodes par an change tout ce qui est annualisé.

| Pas | Périodes/an |
|---|---|
| 1 j | 365 (la crypto ne ferme pas) |
| 4 h | 2 190 |
| 1 h | 8 760 |

Utiliser 252 (jours de bourse actions) sur de la crypto est une erreur classique : cela sous-estime la volatilité annualisée de ~20 %.

## Lié

- `calcul-verifie` : les formules de conversion.
- `horodatage` : la bougie en cours, les fuseaux.
