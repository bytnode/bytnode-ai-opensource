---
name: plan-backtest
description: Spécifier la validation d'une stratégie avant de la coder — données, période, hors échantillon, frictions, métriques, seuils de rejet — pour la remettre à un quant
---

# Plan de backtest

Un backtest sans plan écrit d'avance trouve toujours ce qu'on veut y voir. Le plan fixe, **avant** de regarder les résultats, ce qui sera mesuré et ce qui fera rejeter la stratégie.

## Le plan

```
## Données
Actifs ; pas de temps ; source (BytNode `get_history`) ; période totale disponible.
Champs nécessaires : OHLCV au minimum ; funding et OI si perp ; indicateurs de BytNode si utilisés.

## Découpage
- Calibration (in-sample) : ex. les 2/3 les plus anciens.
- Hors échantillon (out-of-sample) : le 1/3 le plus récent, regardé UNE fois, à la fin.
- Mieux : walk-forward — fenêtres glissantes de calibration puis test.
La période doit contenir au moins un marché haussier, un baissier et un range.

## Frictions
Frais : maker … %, taker … % (valeurs réelles de l'échange visé).
Slippage : … % par ordre, plus élevé sur altcoins et en stress.
Funding sur perp : réel, tiré de l'historique, pas une moyenne.
Exécution : à la clôture de la bougie suivante, jamais à la bougie du signal.

## Métriques (toutes, pas seulement le rendement)
- Rendement annualisé et drawdown maximal → ratio Calmar.
- Sharpe et Sortino (préciser le taux sans risque et la fréquence).
- Nombre de trades, taux de réussite, gain moyen / perte moyenne, espérance en R.
- Durée moyenne des positions ; plus longue série de pertes.
- Exposition moyenne (temps en position) ; rendement par unité d'exposition.
- Stabilité : mêmes métriques par année et par régime.

## Seuils de rejet (fixés maintenant)
Ex. : drawdown max > 20 % ; Sharpe hors échantillon < 0,8 ; moins de 50 trades ;
dégradation hors échantillon > 40 % par rapport à la calibration ;
résultat qui disparaît quand un paramètre bouge de ±20 %.

## Robustesse
- Sensibilité : chaque paramètre ±20 %, ±50 % → la performance doit se dégrader doucement.
- Décalage : démarrer le backtest à des dates différentes.
- Actifs voisins : la logique tient-elle sur ETH si conçue sur BTC ?
- Comparaison à une référence : acheter-et-garder, et une version aléatoire des entrées avec les mêmes sorties.
```

## Ce qu'on remet au Quantitatif

Le canevas de `conception-strategie` rempli + ce plan. Le quant ne doit pas avoir à choisir une période, une friction ou une métrique : ces choix sont de la stratégie, et les faire après coup, c'est tricher sans le vouloir.

## Ce qu'on refuse

- Un backtest sans frais ni slippage.
- Une seule période, ou une période sans marché baissier.
- Une optimisation sur toute la période puis un « test » sur la même.
- Un résultat sans nombre de trades ni drawdown.
- Conclure sur moins de 30–50 trades.
