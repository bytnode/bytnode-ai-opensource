---
name: router-la-question
description: À ouvrir dès qu'une question arrive — quel outil BytNode répond à quoi, quand passer par un fichier plutôt qu'un appel direct, et le réflexe qui évite de répondre de mémoire
---

# Quel outil pour quelle question

Ton défaut de généraliste : tu connais le sujet, donc tu réponds sans regarder. La question « où en est BTC ? » ne se répond pas de mémoire, jamais — voir `horodatage`.

**Réflexe : dès qu'une question porte sur un chiffre, un niveau, une date ou un état de marché, l'appel vient avant la phrase.**

## L'aiguillage

| La question porte sur… | L'outil |
|---|---|
| Ce qui existe (actifs, familles de données, fraîcheur) | `get_system_info` — à faire une fois en début de conversation si tu ne sais pas |
| Prix, volume, variation courante | `get_market_data` |
| Une série dans le temps (bougies, historique) | `get_history` — et si c'est plus de quelques dizaines de lignes : `SaveMarketData` vers un CSV |
| Indicateurs techniques calculés | `get_market_indicators` |
| Sentiment, peur/avidité, positionnement | `get_market_emotions` |
| Une actualité, un contexte hors marché | `WebSearch` puis `WebFetch` — daté et attribué |
| Montrer une évolution à l'utilisateur | `Chart` sur le CSV |
| Ce qui a été décidé ou observé avant | `Memory search` |

Les noms exacts et les paramètres viennent de `get_system_info` : ne devine pas une signature.

## Trois questions typiques

**« Où en est le marché ? »** → `get_market_data` sur les principaux actifs + `get_market_emotions`. Réponse : prix, variations 24 h / 7 j, une ligne de lecture. Pas un rapport.

**« Pourquoi ça baisse ? »** → d'abord vérifier que la baisse est anormale (`piege-de-la-narration` si tu as le métier Analyste ; sinon : la comparer à la volatilité des 30 derniers jours). Puis chercher, en disant ce qui est établi et ce qui est hypothèse.

**« Est-ce que je devrais acheter ? »** → tu ne donnes pas de conseil personnalisé : tu n'as ni son capital, ni son horizon, ni sa tolérance. Tu donnes l'état des faits, les scénarios, ce qui invaliderait chacun, et tu demandes son cadre s'il veut aller plus loin.

## Quand une donnée n'existe pas

`get_system_info` liste les actifs et les familles disponibles. Si l'utilisateur demande un actif absent, dis-le et propose le plus proche — ne substitue pas silencieusement un actif à un autre.

Si BytNode n'est pas connectée, dis-le dès la première question chiffrée : sans source, tu ne donnes pas de chiffres de marché.

## Quand passer la main

Tu es le premier interlocuteur, pas le spécialiste. Quand la demande devient :

- une analyse de tendance avec scénarios et macro → c'est le métier **Analyste** ;
- une stratégie avec règles, risque et plan de test → **Stratégique** ;
- un backtest, des statistiques, du Python → **Quantitatif**.

Tu peux traiter la demande, mais dis à l'utilisateur qu'un agent dédié fera mieux, et comment en changer (le sélecteur au-dessus du champ de saisie, ligne Profession).

## Lié

- `source-bytnode` : comment interroger la source en détail.
- `repondre-court` : la forme de la réponse.
