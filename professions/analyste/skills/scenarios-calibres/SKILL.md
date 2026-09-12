---
name: scenarios-calibres
description: À ouvrir pour conclure une analyse — comment écrire des scénarios avec des probabilités qui somment à 1, des seuils observables, et un signal d'invalidation par scénario
---

# Trois scénarios, des probabilités, des seuils

Ta conclusion type est un dégradé de prudence : « probablement », « il est possible que », « les risques restent orientés à la baisse ». Personne ne peut agir là-dessus, et personne ne peut te contredire — c'est le problème : une analyse non falsifiable n'a aucune valeur.

**Règle : la conclusion prend la forme de scénarios chiffrés, mutuellement exclusifs, dont les probabilités somment à 1.**

## Le gabarit

| Scénario | Probabilité | Condition observable | Invalidé si | Horizon |
|---|---:|---|---|---|
| Continuation baissière | 45 % | clôture 1 j < 103 000 | clôture > 111 500 | 3 semaines |
| Consolidation | 35 % | reste entre 103 000 et 111 500 | sortie du canal, volume > MM20 | 3 semaines |
| Reprise haussière | 20 % | clôture 1 j > 111 500 avec OI en hausse | retour sous 107 000 | 3 semaines |

Quatre exigences :

1. **Somme à 100 %** — vérifie-la, c'est une addition que tu rates.
2. **Exclusifs et exhaustifs** : deux scénarios ne peuvent pas être vrais ensemble, et le cas « rien de tout ça » n'existe pas.
3. **Seuils en prix et en date**, pas en impressions. « Si le momentum faiblit » n'est pas une condition observable.
4. **Horizon identique** pour tous : des probabilités à horizons différents ne s'additionnent pas.

## Les probabilités : d'où elles viennent

Elles ne sortent pas de ton intuition. Trois sources acceptables, à citer :

- **La fréquence historique** du cas comparable (`taux-de-base`) — le point de départ par défaut.
- **La volatilité implicite ou réalisée** : la probabilité d'atteindre un niveau se déduit de la distance et de la volatilité.

```python
import pandas as pd, numpy as np
from math import erf, sqrt
c = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time")["close"]
sig = c.pct_change().tail(30).std()          # vol journalière
jours, cible = 21, 103_000
d = np.log(cible / c.iloc[-1]) / (sig * sqrt(jours))
print(f"P(toucher {cible} en {jours} j) ≈ {0.5*(1+erf(d/sqrt(2))):.0%} (marche aléatoire, vol 30 j)")
```

- **Une asymétrie identifiée** (positionnement, flux, événement daté), en disant de combien elle déplace la probabilité de base et pourquoi.

Et le garde-fou : une probabilité de 5 % ou de 95 % sur un horizon de trois semaines en crypto est presque toujours une erreur de calibration. Reste entre 10 % et 80 % sauf argument fort.

## La calibration, c'est un engagement

Un scénario à 45 % doit se réaliser environ 45 fois sur 100. Deux conséquences pratiques :

- **Note ta prévision** avec `Memory` (seuils, horizon, probabilités) pour pouvoir la relire après coup. C'est la seule façon de savoir si tu es calibré.
- **Relis les précédentes** quand tu ouvres une analyse sur le même actif : « ma lecture du 28/08 donnait 60 % à la consolidation ; elle s'est réalisée / ne s'est pas réalisée, voici ce que je corrige ».

## Ce qu'on n'écrit pas

- « Tout est possible », « le marché décidera », « la prudence est de mise ».
- Un scénario unique. Un seul chemin annoncé, c'est une prédiction, pas une analyse.
- Une probabilité sans horizon.
- Des conseils de position (« achète ici, stop là ») : c'est le métier Stratégique, et il faut le cadre de l'utilisateur.

## Lié

- `taux-de-base` : la fréquence qui fonde la probabilité.
- `contradiction-obligatoire` : le scénario qui dérange doit exister.
- `rapport-analyse` : où les scénarios se placent dans le rapport.
