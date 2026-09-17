---
name: trade-review
description: À ouvrir pour analyser des positions ouvertes ou un historique de trades sur un compte exchange — les lectures à faire, les seuils d'alerte (liquidation, funding, concentration), le gabarit de revue, et comment tracer l'historique
---

# Revoir des positions et des trades

Analyser n'engage rien : les outils de lecture ne demandent pas de permission. Mais une revue qui rate une liquidation à 4 % ou qui annonce un PnL de tête ne vaut rien. La méthode :

## Positions ouvertes

1. `ExchangePositions` (compte, éventuellement `symbol`) : côté, taille, entrée, mark, PnL latent, levier, liquidation.
2. `ExchangeTicker` en `market: futures` sur chaque paire : funding courant et prochain funding — un long paie le funding positif, un short le reçoit.
3. `ExchangeBalance` en `market: futures` : la marge libre, c'est la distance au premier appel de marge sur l'ensemble du compte.

**Seuils à signaler d'office** (en tête de réponse, pas en note de bas de page) :
- distance à la liquidation **< 10 %** : alerte ; **< 5 %** : urgence, propose `ClosePosition` partiel ou un ajout de marge (`Transfer` spot → futures) — l'utilisateur décide ;
- funding annualisé supérieur au gain latent attendu ;
- une paire qui pèse plus de la moitié de l'exposition notionnelle du compte ;
- une position sans ordre de protection en attente (`ExchangeOrders status: open`, cherche un `stop` opposé au côté).

Pour **suivre** une position pendant quelques minutes : `ExchangeWatch` avec `until` (`liq<5%`, `pnl<-50`, `price>=…`). Il s'arrête tout seul au bout de 10 minutes ; relance-le si l'utilisateur veut continuer.

## Historique

1. `ExchangeOrders` avec `status: "closed"`, une paire à la fois si l'exchange l'exige, `since` pour la période, `limit` jusqu'à 200.
2. Pour plus de quelques dizaines de lignes, écris-les en CSV dans le dossier de travail (`Write`, colonnes `date,symbol,side,type,amount,price,average,filled,fee,fee_currency,status`) puis `Chart` pour tracer (courbe de PnL cumulé, répartition des fills).
3. Les métriques, toutes **calculées en exécutant** (compétence `calcul-verifie`) : PnL réalisé par période et par paire, frais totaux, nombre de trades, taux de gain, gain moyen / perte moyenne, plus grosse perte, drawdown de la courbe cumulée.

## Gabarit de revue

```
Compte : <label> (<exchange>, RÉEL | testnet) — <date/heure de lecture>

Alertes : <ce qui dépasse un seuil, ou « aucune »>

Positions
<paire> · <LONG/SHORT taille> · entrée <p> · mark <p> · PnL <±x (±y %)> · ×<levier> · liquidation <p> (<d %>) · funding <r %> (prochain <heure>)

Marge libre : <x USDT> · Exposition notionnelle : <x USDT> (<paire> = <y %>)

Historique <période>
<n> trades · PnL réalisé <±x> · frais <x> · gain <y %> · pire trade <±x> · drawdown <x %>
[graphique]

Lecture : <trois phrases au plus — ce qui va, ce qui inquiète, ce que tu proposes ; les décisions sont celles de l'utilisateur>
```

Un chiffre = une lecture d'outil ou un calcul exécuté. Si une donnée manque (l'exchange ne publie pas la liquidation, l'historique est tronqué), dis-le au lieu de compléter.
