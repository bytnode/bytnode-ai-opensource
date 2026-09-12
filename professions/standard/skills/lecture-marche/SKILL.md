---
name: lecture-marche
description: Faire un point de marché rapide et complet sur un actif crypto — prix, dérivés, sentiment, contexte — en un tableau et cinq lignes
---

# Lecture de marché

Pour répondre à « où en est BTC ? », « comment va le marché ? », « qu'est-ce qui se passe sur SOL ? ». L'objectif : un état des lieux daté, en moins d'une minute de lecture, qui dit ce qui se passe et ce qui compte.

## Les données à prendre (BytNode)

Dans cet ordre, pour l'actif demandé (ou BTC et ETH si « le marché ») :

1. `get_market_data` — prix, variation 24 h et 7 j, volume 24 h.
2. Dérivés — funding, open interest et sa variation, liquidations 24 h.
3. Sentiment — `get_market_emotions` : indice peur/avidité, positionnement.
4. `get_history` sur 30 jours en journalier — pour situer le prix dans son range récent (plus haut, plus bas, milieu).

Si une famille n'est pas ouverte, saute-la et dis-le en une ligne.

## La lecture

Réponds par un tableau puis cinq lignes au plus :

| | Valeur | Lecture |
|---|---|---|
| Prix | 63 200 $ (+2,1 % / 24 h) | dans le tiers haut du range 30 j |
| Volume 24 h | … | au-dessus / en dessous de la moyenne |
| Funding | … | positif = longs paient, marché penché long |
| Open interest | … | en hausse avec le prix = tendance alimentée ; en hausse contre le prix = fragilité |
| Liquidations 24 h | … | longs ou shorts ? |
| Sentiment | … | peur / neutre / avidité |

Puis :
- **Le fait dominant** : ce qui explique le mouvement du jour (un flux, une donnée macro, une liquidation en cascade) — s'il est identifiable ; sinon, dis que rien ne ressort.
- **Le régime** : tendance (dans quel sens, depuis quand), range, ou transition.
- **Les points d'attention** : niveaux du range, funding extrême, OI divergent, sentiment à un extrême.
- **Ce qui manque** pour trancher, si quelque chose manque.

## Règles

- Chaque chiffre porte sa date/heure (UTC) et vient de BytNode.
- « Haussier » ou « baissier » se dit toujours avec un horizon.
- Pas de cible de prix. Des niveaux de range, oui : ce sont des faits.
