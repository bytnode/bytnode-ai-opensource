---
name: statistiques-des-series
description: À ouvrir avant d'affirmer qu'un résultat est significatif — pourquoi les tests classiques mentent sur des rendements financiers, et quoi utiliser à la place (bootstrap par blocs, fenêtres non chevauchantes, intervalles)
---

# Les tests classiques mentent sur des rendements

Tu appliques les recettes des cours de statistiques : t-test, p-value, intervalle de confiance normal. Ces recettes supposent des observations indépendantes, de même loi, de variance stable. Les rendements financiers ne vérifient aucune des trois. Résultat : une significativité annoncée qui n'existe pas.

## Les quatre hypothèses violées

| Hypothèse | Réalité des marchés | Conséquence |
|---|---|---|
| Indépendance | volatilité groupée en amas (une journée agitée suit une journée agitée) | erreur-type sous-estimée → p-value trop belle |
| Normalité | queues épaisses, kurtosis élevé | les événements « impossibles » arrivent plusieurs fois par an |
| Variance constante | régimes de volatilité | un Sharpe stable en moyenne cache deux régimes opposés |
| Observations distinctes | fenêtres glissantes chevauchantes | `n` est bien plus petit que le nombre de lignes |

## Ce qu'on utilise à la place

### Bootstrap par blocs

Rééchantillonner ligne par ligne détruit l'autocorrélation, donc sous-estime l'incertitude. Par blocs, elle est préservée.

```python
import numpy as np, pandas as pd

def bootstrap_blocs(net: pd.Series, ppy: int, taille_bloc: int = 20, n: int = 5_000, seed: int = 0):
    r = net.dropna().to_numpy()
    rng = np.random.default_rng(seed)
    nb = len(r) // taille_bloc
    sharpes = np.empty(n)
    for i in range(n):
        deb = rng.integers(0, len(r) - taille_bloc, nb)
        ech = np.concatenate([r[d : d + taille_bloc] for d in deb])
        sd = ech.std(ddof=1)
        sharpes[i] = (ech.mean() * ppy) / (sd * np.sqrt(ppy)) if sd else np.nan
    q = np.nanquantile(sharpes, [0.05, 0.5, 0.95])
    print(f"Sharpe médian {q[1]:.2f} — intervalle 90 % [{q[0]:.2f} ; {q[2]:.2f}]")
    return q
```

**Lecture** : si l'intervalle contient 0, il n'y a pas de preuve d'avantage. C'est la phrase qui remplace « p < 0,05 ».

### Fenêtres non chevauchantes

Pour comparer des périodes, découpe sans recouvrement. Trente-six fenêtres glissantes de 90 jours sur un an ne sont pas 36 observations : c'est environ 4.

```python
n_effectif = len(serie) // fenetre          # et non len(serie) - fenetre + 1
```

### Le nombre de trades, pas de bougies

La statistique d'une stratégie porte sur ses **trades**. Un backtest de 8 000 bougies avec 22 trades a un échantillon de 22.

| Trades | Ce qu'on peut dire |
|---|---|
| < 20 | rien. Décris les trades un par un |
| 20 à 50 | « indicatif », intervalles très larges |
| 50 à 200 | exploitable avec bootstrap et intervalles |
| > 200 | solide, si les trades sont indépendants |

### L'erreur-type d'un Sharpe

Ordre de grandeur utile : `SE(Sharpe) ≈ sqrt((1 + SR²/2) / n_années_équivalentes)`. Sur 3 ans, l'erreur-type est de l'ordre de 0,6 : un Sharpe mesuré à 1,0 est compatible avec un vrai Sharpe de 0,4 comme de 1,6. Donne l'intervalle, pas le point.

## Ce qu'une p-value ne dit pas

Elle donne la probabilité d'observer ces données **si la stratégie n'avait aucun avantage**. Elle ne donne pas la probabilité que la stratégie marche. Et elle perd tout sens si tu as essayé vingt variantes : voir les tests multiples dans `validation-statistique`.

## Les trois lignes de contrôle

Avant toute affirmation de significativité :

```python
r = net.dropna()
print(f"n = {len(r)} — autocorrélation(1) = {r.autocorr(1):.3f} — kurtosis = {r.kurt():.1f}")
print(f"écart-type 1ʳᵉ moitié {r[:len(r)//2].std():.5f} vs 2ᵈᵉ {r[len(r)//2:].std():.5f}")
```

Une autocorrélation notable, un kurtosis élevé ou deux écarts-types qui diffèrent d'un facteur deux : les tests paramétriques sont hors jeu, passe au bootstrap.

## La formulation honnête

> Sharpe 1,08 sur 4,2 ans (74 trades). Bootstrap par blocs de 20 : intervalle 90 % [0,21 ; 1,86]. Autocorrélation d'ordre 1 : 0,04 ; kurtosis 6,3 ; volatilité deux fois plus élevée sur la seconde moitié. Conclusion : avantage **plausible mais non établi** — l'intervalle frôle zéro et l'échantillon de trades est modeste.

## Lié

- `validation-statistique` : le protocole complet (hors échantillon, tests multiples, déflation).
- `definitions-metriques` : comment chaque métrique est définie.
- `taux-de-base` (métier Analyste) : la même prudence, côté analyse.
