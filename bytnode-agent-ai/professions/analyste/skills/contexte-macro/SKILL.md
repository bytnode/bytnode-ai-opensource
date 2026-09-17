---
name: contexte-macro
description: Lire le contexte macroéconomique qui pèse sur les actifs risqués et le relier au marché crypto — taux, dollar, liquidité, appétit pour le risque, calendrier
---

# Contexte macro

La crypto est un actif risqué à bêta élevé : elle amplifie ce que fait la liquidité mondiale. Une analyse qui ignore la macro décrit la vague sans voir la marée.

## La grille

Pour chaque facteur : la valeur actuelle, sa direction récente, et ce qu'elle fait aux actifs risqués *en ce moment* (la relation peut se retourner : vérifie sur les 3 derniers mois avec `get_history` si BytNode couvre la macro, sinon WebSearch, sources officielles d'abord — banques centrales, offices statistiques, presse financière de référence).

| Facteur | Ce qu'on regarde | Lecture usuelle |
|---|---|---|
| Politique monétaire | Taux directeurs Fed/BCE, anticipations de baisse/hausse (contrats à terme), prochain FOMC | Anticipations de baisse = soutien au risque ; surprise restrictive = retrait |
| Taux réels | Rendement 10 ans US moins inflation anticipée | Réels en hausse = pression sur les actifs sans rendement (or, crypto) |
| Dollar | DXY, tendance 1–3 mois | Dollar fort = vent contraire pour la crypto, historiquement |
| Liquidité | Bilan des banques centrales, réserves bancaires, conditions financières | Liquidité en expansion = terrain porteur |
| Appétit pour le risque | Nasdaq, actions à petite capitalisation, spreads de crédit high yield, VIX | Risk-on/risk-off ; la crypto suit le Nasdaq avec un bêta > 1 |
| Or | Tendance, corrélation récente avec BTC | Quand les deux montent : narratif « dévaluation » ; quand ils divergent : la crypto se comporte en actif risqué, pas en refuge |
| Flux propres à la crypto | Flux ETF spot (BytNode), stablecoins émis/rachetés | Flux entrants soutenus = demande structurelle |

## Le calendrier

Liste les événements des 7 prochains jours qui peuvent bouger le marché : FOMC, CPI/PCE, emploi US, décisions BCE, expirations d'options crypto (fin de mois, fin de trimestre), déblocages de tokens, décisions réglementaires. Un événement à moins de 48 h rend toute lecture court terme conditionnelle : dis-le.

## La synthèse

Trois lignes :
- **Régime** : porteur / neutre / hostile pour le risque, et le facteur dominant.
- **Ce qui a changé** récemment (deux semaines).
- **Le risque de bascule** : quel événement ou quel seuil (ex. 10 ans au-dessus de X %, DXY au-dessus de Y) changerait le régime.

Puis relie explicitement au marché crypto : « dans ce régime, un rebond de BTC sans amélioration des flux ETF serait fragile » — une phrase de lien, pas une théorie.

## Règles

- Chaque chiffre macro a sa date et sa source (organisme, page).
- Les corrélations se vérifient, elles ne se supposent pas : donne la période d'observation.
- Pas de prédiction macro ; des scénarios (« si la Fed baisse en X, alors… ») avec ce qui les invalide.
