---
name: source-bytnode
description: Comment interroger BytNode, la source de données de marché — quels outils, dans quel ordre, et comment lire ce qui revient
---

# BytNode, la source de données

**Séries volumineuses → `SaveMarketData`.** Dès qu'un appel rend plus de quelques dizaines de lignes (historique de bougies, série d'indicateurs), ne l'appelle pas directement : `SaveMarketData(tool="get_history", args={…}, output="data/btc_4h.csv")` écrit le CSV et ne te rend qu'un résumé. Ensuite `Chart` pour montrer, `Backtest` ou pandas pour calculer.

BytNode agrège les données crypto en une seule API : marché (prix, volumes, carnets), dérivés (funding, open interest, liquidations), options, on-chain, flux ETF, macro et sentiment — treize familles sur les principaux actifs. Tu y accèdes par des outils dont le nom commence par `get_`. Ce sont des données réelles et datées : elles priment sur ta mémoire, qui a une date de coupure.

## Dans quel ordre

1. **`get_system_info`** — commence par là si tu ne sais pas ce qui existe : actifs couverts, familles disponibles pour ce compte, horizons d'historique, fraîcheur. Ne le rappelle pas à chaque question ; une fois par conversation suffit.
2. **`get_market_data`** — l'instantané : prix, volume, variation, et selon la famille demandée les dérivés ou le sentiment du moment. Pour « où en est BTC », « quel est le funding sur ETH ».
3. **`get_history`** — les séries dans le temps, sur un pas de temps (`timeframe`) : indispensable pour toute tendance, toute comparaison à une date passée, tout calcul.
4. **`get_market_indicators`** — des indicateurs déjà calculés (moyennes, oscillateurs, volatilité…) : prends-les plutôt que de les recalculer de tête.
5. **`get_market_emotions`** — le sentiment agrégé (peur/avidité, positionnement, flux). Une lecture en contexte, jamais un signal seul.

Lis la description de chaque outil : elle dit les paramètres acceptés (actif, famille, horizon). Si un paramètre est refusé, la réponse te dit lesquels sont valides — corrige et rappelle, n'invente pas.

## Comment lire ce qui revient

- **Note la date** de chaque donnée et donne-la dans ta réponse (« au 11 septembre, 14 h UTC »). Une donnée sans date n'est pas une information.
- **Distingue ce qui vient de BytNode** de ce que tu ajoutes : « BytNode indique X ; j'en déduis Y ».
- **Un chiffre isolé ne dit rien** : compare à la veille, à la semaine, à la moyenne. `get_history` sert à ça.
- Si la donnée manque (famille non ouverte sur ce compte, actif hors couverture, historique trop court), dis-le tel quel et propose ce que tu peux faire à la place. Ne comble jamais un trou avec un souvenir.
- Les volumes et l'open interest se lisent en unités : précise-les (USD, contrats, BTC).

## Quand ne pas l'appeler

- Pour une question de définition ou de méthode (« qu'est-ce que le funding ? ») : réponds directement.
- Pour une donnée hors crypto (taux Fed, DXY, actions) : vérifie d'abord dans `get_system_info` si la famille macro la couvre ; sinon WebSearch, en citant la source.
