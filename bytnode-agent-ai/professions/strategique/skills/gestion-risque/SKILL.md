---
name: gestion-risque
description: Les règles de risque d'une stratégie ou d'un portefeuille — taille de position, limites par jour et globales, corrélation, levier, scénarios de stress — chiffrées
---

# Gestion du risque

Le risque se décide avant la première position, en chiffres, et ne se renégocie pas en cours de route. Toute stratégie livrée porte cette section remplie.

## Les couches

1. **Par position** — le risque, c'est la perte si le stop est touché, pas la taille. Règle : risque ≤ R % du capital (1 % est un point de départ courant ; 0,5 % pour une stratégie fréquente ; jamais plus de 2 %). Taille = (capital × R) / (distance au stop en prix). Le stop est un niveau de marché (ATR, structure), pas un pourcentage arbitraire.
2. **Par jour / par semaine** — perte maximale cumulée avant d'arrêter (ex. 3 R par jour, 6 R par semaine). L'arrêt est mécanique.
3. **Global** — drawdown maximal accepté depuis le plus haut du capital (ex. 15 %). À mi-chemin (7,5 %), on réduit les tailles de moitié ; au seuil, on arrête et on réexamine la stratégie, pas les paramètres.
4. **Concentration** — exposition maximale par actif et par thème (les altcoins sont un seul thème : ils corrèlent à 0,8+ avec BTC en stress). Somme des risques ouverts ≤ 3–5 R.
5. **Levier** — exprimé en exposition notionnelle / capital. Sur perp, le levier réel inclut le funding : un funding de 0,05 % / 8 h coûte ~55 % par an ; à intégrer dans le coût de portage et dans la décision de tenir.

## Scénarios de stress

Pour chaque stratégie, chiffrer la perte dans :
- **Gap** de −20 % sur BTC en une heure (arrive quelques fois par an) : stops non exécutés au niveau, slippage ×5.
- **Cascade de liquidations** : spread ×10 pendant quelques minutes, ordres partiellement exécutés.
- **Panne ou gel d'échange** : impossibilité de sortir pendant 1–6 h.
- **Régime inverse** : la stratégie prend N pertes consécutives (calculer N pour un taux de réussite donné : à 40 %, 8 pertes de suite arrivent régulièrement).
Si l'un de ces cas dépasse le drawdown maximal, la taille ou le levier est trop grand. Point.

## Corrélation

Avant d'ouvrir une position, la question : que se passe-t-il si tout le portefeuille bouge dans le même sens ? Mesurer la corrélation 30 j entre les actifs (avec `get_history` de BytNode) ; deux positions à 0,9 de corrélation sont une position de taille double.

## Ce qu'on écrit dans la stratégie

| Paramètre | Valeur |
|---|---|
| Risque par position | … % du capital |
| Stop initial | … (règle de marché) |
| Perte max / jour, / semaine | … R |
| Drawdown max, seuil de réduction | … %, … % |
| Exposition max par actif / thème | … % |
| Risque ouvert total max | … R |
| Levier notionnel max | … × |
| Perte estimée en gap −20 % | … % du capital |

## Règles

- Les limites sont mécaniques : on ne « voit » pas si on continue, on arrête.
- On ne moyenne pas à la baisse une position perdante sauf si c'est une règle écrite dès le départ.
- Le risque se mesure en R (multiple du risque initial), pas en euros : c'est ce qui rend les stratégies comparables.
