---
name: validation-statistique
description: Vérifier qu'un résultat quantitatif tient — hors échantillon, walk-forward, sensibilité, références naïves, tests multiples, déflation du Sharpe — et le dire sans complaisance
---

# Validation statistique

Un résultat de backtest est une hypothèse jusqu'à preuve du contraire. La preuve, c'est qu'il survit à tout ce qui suit. Si une étape échoue, le verdict est « ne tient pas » — pas « à affiner ».

## 1. Le découpage

- **Hors échantillon** : la période la plus récente (≥ 1/3), regardée **une seule fois**, après toute calibration. La regarder deux fois en fait de l'in-sample.
- **Walk-forward** : fenêtres de calibration N mois → test M mois, glissantes. La performance qui compte est la concaténation des fenêtres de test.
- **Régimes** : mesurer séparément en tendance haussière, baissière, range (définis à l'avance, ex. par la pente de la MM200). Une stratégie qui ne gagne que dans un régime n'est validée que si son filtre de régime est dans les règles.

## 2. Les références naïves

Toujours comparer à :
- acheter-et-garder sur la même période ;
- la même stratégie avec des **entrées aléatoires** (mêmes règles de sortie et de taille), 1 000 tirages : où se situe le résultat réel dans cette distribution ? S'il est sous le 95e percentile, l'entrée n'apporte rien.

## 3. La sensibilité

Chaque paramètre ±20 % et ±50 % : tracer la métrique (Sharpe, Calmar) en fonction du paramètre. On veut un **plateau**, pas un pic. Un pic = ajustement au bruit. Le couple de paramètres retenu doit être au milieu du plateau, pas au sommet.

## 4. Les tests multiples

Si tu as essayé K variantes (paramètres, filtres, actifs) avant de retenir la meilleure, le meilleur Sharpe est biaisé vers le haut. Corrige :
- **Sharpe déflaté** (Bailey & López de Prado) : ajuste pour K essais, la longueur de l'échantillon, l'asymétrie et le kurtosis des rendements.
- À défaut, règle simple : compte K honnêtement et exige que le résultat reste positif après une pénalité de `sqrt(2·ln K)/sqrt(T)` en unités de Sharpe annualisé, avec T le nombre d'années.
- Note K dans le rapport. Ne pas le noter, c'est le cacher.

## 5. L'incertitude

- **Bootstrap** des trades (ou des blocs de rendements pour garder l'autocorrélation) : intervalle à 90 % du Sharpe et du drawdown max. Un intervalle qui contient zéro = pas de preuve.
- **Nombre de trades** : sous 50, rien n'est concluant ; dis combien il en faudrait pour l'effet observé.
- **Série de pertes** : la plus longue observée vs celle attendue pour le taux de réussite (binomiale) — si l'observée est bien plus courte, l'échantillon est trop clément.

## 6. Le verdict

Un tableau :

| Test | Résultat | Verdict |
|---|---|---|
| Hors échantillon | Sharpe X vs Y in-sample (−Z %) | tient / ne tient pas |
| Walk-forward | … | |
| Entrées aléatoires | percentile … | |
| Sensibilité | plateau / pic | |
| Tests multiples (K = …) | Sharpe déflaté … | |
| Bootstrap 90 % | [ … ; … ] | |
| Nombre de trades | … | |

Puis une conclusion en trois lignes : tient / ne tient pas / indéterminé ; ce qui l'affaiblit le plus ; ce qu'il faudrait pour trancher.

## Règles

- Les seuils de rejet sont ceux du plan de backtest, fixés avant. On ne les déplace pas après avoir vu les résultats.
- On rapporte tous les tests, y compris ceux qui échouent.
- Une p-value dit la probabilité des données sous l'hypothèse nulle, pas la probabilité que la stratégie marche. Ne la survends pas.
