---
name: conception-strategie
description: Le canevas d'une stratégie de trading ou d'investissement écrite pour être exécutée et testée — intention, hypothèse, univers, règles chiffrées, exécution, faiblesses
---

# Conception d'une stratégie

Le livrable est un document que quelqu'un d'autre peut appliquer ou coder sans te poser de question. S'il faut l'écrire, `strategie-<nom>.md` dans le dossier de travail.

## Canevas

```
# Stratégie <nom>

## Intention
Une phrase. Ex. : capter les tendances de plusieurs semaines sur BTC et ETH en limitant le drawdown à 15 %.

## Contraintes
Capital ; horizon ; drawdown max ; fréquence de décision (par bougie 4 h, journalière…) ;
marchés autorisés (spot / perp / options) ; levier max ; contraintes pratiques (temps disponible, automatisation).

## Hypothèse de marché
D'où vient l'avantage, en deux phrases, et pourquoi il devrait persister.
Ex. : les tendances crypto persistent sur plusieurs semaines parce que les flux (ETF, stablecoins) sont
autocorrélés ; l'avantage disparaît en range, d'où un filtre de régime.

## Univers
Actifs et critères de sélection (liquidité minimale : volume 24 h > X, spread < Y).

## Règles
| Élément | Règle | Paramètre |
|---|---|---|
| Régime / filtre | ex. clôture > MM200 journalière et ADX(14) > 20 | 200, 14, 20 |
| Entrée | ex. clôture 4 h au-dessus du plus haut 20 bougies | 20 |
| Taille | ex. risque 1 % du capital par position, taille = 1 % / distance au stop | 1 % |
| Stop initial | ex. 2 × ATR(14) sous l'entrée | 2, 14 |
| Sortie | ex. stop suiveur 3 × ATR ou clôture sous MM50 4 h | 3, 50 |
| Pyramidage | autorisé / non ; conditions | |
| Temps | sortie forcée après N bougies sans progrès | N |

## Risque
Renvoi à `gestion-risque` : limites par position, par jour, globales ; corrélation entre positions ;
levier ; comportement en stress (gap, liquidation en cascade, panne d'échange).

## Exécution
Type d'ordres ; frais supposés (maker/taker) ; slippage supposé ; fenêtre d'exécution ;
ce qu'on fait si le prix a déjà bougé de plus de X % au moment d'agir.

## Validation
Renvoi à `plan-backtest` : période, hors échantillon, métriques, seuils de rejet.

## Faiblesses connues
Régimes où elle perd ; sensibilité aux paramètres ; coût de friction ; ce qui casserait l'hypothèse.
```

## Règles de conception

- **Une hypothèse, une stratégie.** Deux hypothèses = deux stratégies, éventuellement combinées après test.
- **Chaque règle a un paramètre nommé** et une valeur par défaut. Le quant les fera varier ; toi, tu dis lesquels comptent.
- **Peu de paramètres.** Au-delà de cinq ou six, la stratégie s'ajuste au passé plus qu'au marché.
- **La sortie compte plus que l'entrée.** Elle est chiffrée avant l'entrée.
- **La friction est une règle.** Une stratégie 1 h sur un actif peu liquide meurt de ses frais : dis-le à la conception, pas au backtest.
- **Le régime est un filtre, pas une excuse.** Si la stratégie ne marche qu'en tendance, la règle de détection du régime fait partie de la stratégie.
- Ancre les valeurs par défaut dans les données réelles (BytNode) : volatilité récente pour l'ATR, volumes pour l'univers, funding pour les coûts de portage sur perp.
