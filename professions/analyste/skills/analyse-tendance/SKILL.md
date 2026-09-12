---
name: analyse-tendance
description: Établir la tendance d'un actif sur trois horizons à partir des séries BytNode — structure de prix, dérivés, on-chain — et en tirer des scénarios conditionnels
---

# Analyse de tendance

## Les données

Pour l'actif, avec `get_history` :
- **Journalier sur 180 jours** — l'horizon long.
- **4 heures sur 30 jours** — l'horizon moyen.
- **1 heure sur 5 jours** — l'horizon court.
Plus, en instantané et en série récente : funding, open interest, liquidations (dérivés) ; flux nets d'échanges et offre en profit (on-chain) ; volatilité implicite (options) ; indicateurs de `get_market_indicators` (moyennes 20/50/200, ATR, RSI) plutôt que recalculés.

## Par horizon : quatre questions

1. **Structure** — le prix fait-il des hauts et des bas plus hauts (tendance haussière), plus bas (baissière), ou dans une bande (range) ? Donne les niveaux : dernier haut, dernier bas, bornes du range.
2. **Position** — où est le prix par rapport aux moyennes 20/50/200 et au range ? En percentile du range 180 j si possible.
3. **Impulsion** — la volatilité (ATR) monte ou baisse ? Le volume accompagne les mouvements dans le sens de la tendance ?
4. **Participation** — l'open interest monte avec le prix (tendance alimentée) ou contre (positions à contre-courant, fragilité) ? Le funding est-il neutre, penché, extrême ? Les liquidations récentes sont-elles des longs ou des shorts ?

## La synthèse

Un tableau horizon × verdict :

| Horizon | Structure | Position | Impulsion | Participation | Verdict |
|---|---|---|---|---|---|
| Long (J, 180 j) | … | … | … | … | haussier / baissier / range |
| Moyen (4 h, 30 j) | … | | | | |
| Court (1 h, 5 j) | … | | | | |

Puis :
- **Alignement** : les trois horizons vont-ils dans le même sens ? Un court contre le long est une correction jusqu'à ce que le moyen bascule.
- **Divergences** : prix qui monte avec OI qui baisse (couvertures, pas d'achats neufs) ; prix à un plus haut avec RSI plus bas ; funding extrême contre le mouvement.
- **On-chain** : flux vers les échanges (pression vendeuse potentielle) ou hors des échanges ; offre en profit élevée (risque de prises de bénéfice).

## Les scénarios

Deux ou trois, jamais un seul :
- **Scénario** : condition (« si le prix tient au-dessus de X et l'OI continue de monter ») → développement attendu → **invalidation** (« sous Y en clôture journalière »).
- Probabilité qualitative justifiée par le nombre de confirmations.
- Ce qu'il faudrait voir dans les 24–72 h pour départager.

## Ce qui invalide l'analyse elle-même

Données trop courtes, actif peu liquide (volumes faibles rendent la structure bruitée), événement macro imminent qui rend le court terme aléatoire. Dis-le.
