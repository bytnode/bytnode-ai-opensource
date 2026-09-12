---
name: definitions-metriques
description: À ouvrir en rapportant des métriques de performance — la définition exacte retenue pour chaque mesure (Sharpe, drawdown, CAGR, exposition, R), pour que deux rapports soient comparables
---

# Une métrique sans définition n'est pas un chiffre

« Sharpe 1,4 » ne veut rien dire tant qu'on ne sait pas : sur quel pas de temps, annualisé avec quel facteur, net de quoi, avec quel taux sans risque. Deux rapports qui ne partagent pas ces choix ne sont pas comparables — et ton défaut est d'en changer d'un rapport à l'autre sans le dire.

**Les définitions ci-dessous sont celles du moteur `Backtest`. Utilise-les telles quelles, et cite-les.**

## Les conventions de la maison

| Métrique | Définition retenue |
|---|---|
| **Rendement de période** | net de frais, slippage et funding. `net = brut − coûts − funding` |
| **Capital** | `(1 + net).cumprod()`, base 1. Réinvestissement total, pas de retrait |
| **Rendement total** | `capital[-1] − 1` |
| **CAGR** | `capital[-1] ** (1 / années) − 1`, avec `années = n_périodes / périodes_par_an`. Sur moins d'un an, on donne le rendement brut de période **et** on dit que l'annualisation n'a pas de sens |
| **Volatilité** | `std(net, ddof=1) × sqrt(périodes_par_an)` |
| **Sharpe** | `moyenne(net) × ppy / volatilité annualisée`, **taux sans risque à 0** — à dire, parce que c'est un choix |
| **Sortino** | même numérateur, dénominateur = écart-type des périodes négatives seulement |
| **Drawdown** | `capital / cummax(capital) − 1`, en **simple** (pas en log). Le maximum est le minimum de cette série |
| **Calmar** | `CAGR / |drawdown max|` |
| **Exposition** | part des périodes avec une position non nulle |
| **Changements de position** | nombre de variations de l'exposition — ce que le moteur appelle `trades` |
| **Trade (aller-retour)** | une entrée suivie d'une sortie, ligne de `trades.csv`. **Différent** du compte précédent : dis lequel tu cites |
| **R** | gain ou perte exprimé en multiples du risque initial (distance à l'entrée / stop) |
| **Taux de réussite** | sur les aller-retours, pas sur les périodes |
| **Périodes par an** | 365 (1 j), 2 190 (4 h), 8 760 (1 h). Jamais 252 en crypto |

## Les pièges de comparaison

- **Sharpe et pas de temps** : un Sharpe calculé sur du 1 h et un autre sur du 1 j ne se comparent pas directement. Cite le pas.
- **Drawdown simple vs log** : le log donne un chiffre plus petit. Nous retenons le simple, parce que c'est ce que l'utilisateur ressent sur son compte.
- **CAGR sur période partielle** : annualiser onze jours de gains donne des centaines de pourcents. Le moteur le calcule, à toi de ne pas le mettre en avant.
- **Rendement d'une stratégie long-short** : rapporté au capital, pas au notionnel. Un levier 3× multiplie le rendement et le drawdown par 3.
- **Acheter-et-garder** : la référence du moteur est exposée à 100 % en permanence. Une stratégie exposée 30 % du temps qui fait moins bien n'est pas battue pour autant — compare aussi le rendement **par unité de risque** et par unité d'exposition.

## Ce qui accompagne toujours un chiffre

Trois éléments, sinon le chiffre ne part pas :

1. **La période** et sa durée réelle.
2. **Le nombre de trades**.
3. **L'incertitude** : l'intervalle de bootstrap, ou à défaut la mention « échantillon insuffisant » (`statistiques-des-series`).

## Le bloc de définitions du rapport

> **Conventions** : rendements nets (frais 6 bp + slippage 5 bp par côté, funding réel), capital en réinvestissement total base 1, Sharpe annualisé à 2 190 périodes/an avec taux sans risque nul, drawdown simple sur le capital, CAGR sur 4,2 ans. « Trades » = 74 aller-retours (`trades.csv`) ; les 148 changements de position du tableau comptent les entrées et les sorties séparément.

Un rapport qui porte ce bloc peut être comparé à un autre six mois plus tard. Sans lui, non.

## Lié

- `backtest-python` : le moteur qui produit ces chiffres.
- `statistiques-des-series` : l'incertitude autour de chacun.
- `validation-statistique` : le verdict qui les utilise.
