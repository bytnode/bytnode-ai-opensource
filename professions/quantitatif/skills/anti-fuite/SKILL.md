---
name: anti-fuite
description: À ouvrir avant tout backtest et à chaque écriture de signal — la liste des fuites de données, et le test mécanique qui les détecte en recalculant le signal sur des historiques tronqués
---

# La fuite du futur, et comment la prouver absente

C'est la faiblesse n°1 du code que tu écris, et la plus dangereuse : elle ne produit aucune erreur, aucun avertissement — seulement un backtest magnifique et une stratégie qui perd en réel. Le moteur `Backtest` garantit l'exécution à la bougie suivante, mais **la fuite peut être dans ton `signal()`**, et là personne ne te protège.

**Règle : aucun backtest n'est présenté sans que le test de causalité ci-dessous ait été exécuté et son résultat cité.**

## Le test mécanique

Le signal à l'instant t ne doit dépendre que des données ≤ t. Donc : recalculé sur un historique tronqué à t, il doit donner la **même valeur**. Un test, une réponse binaire.

```python
import numpy as np, pandas as pd, importlib.util

def charge(path):
    spec = importlib.util.spec_from_file_location("s", path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

def test_causalite(csv: str, strategy: str, params: dict | None = None, n: int = 30, seed: int = 0) -> None:
    df = pd.read_csv(csv, parse_dates=["time"]).set_index("time").sort_index()
    mod = charge(strategy)
    complet = mod.signal(df, **(params or {}))
    rng = np.random.default_rng(seed)
    coupes = rng.integers(int(len(df) * 0.5), len(df) - 1, n)
    fautes = []
    for t in coupes:
        tronque = mod.signal(df.iloc[: t + 1], **(params or {}))
        a, b = complet.iloc[t], tronque.iloc[-1]
        if not (pd.isna(a) and pd.isna(b)) and not np.isclose(float(a), float(b), equal_nan=True):
            fautes.append((df.index[t], float(a), float(b)))
    if fautes:
        print(f"FUITE : {len(fautes)}/{n} coupes divergent. Exemples : {fautes[:3]}")
    else:
        print(f"causalité OK sur {n} coupes aléatoires")
```

À lancer avant chaque backtest, et à citer : « causalité vérifiée sur 30 coupes ». Si une seule coupe diverge, le résultat du backtest ne vaut rien — corrige d'abord.

## Les fuites, par ordre de fréquence

| Fuite | À quoi ça ressemble | La correction |
|---|---|---|
| **Moyenne centrée** | `rolling(20, center=True)` | `rolling(20)` |
| **Normalisation globale** | `(x - x.mean()) / x.std()` sur toute la série | `x.rolling(n).mean()` / `rolling(n).std()` |
| **Décalage oublié** | comparer `close[t]` à un seuil calculé avec `close[t]` inclus… et exécuter à `t` | le moteur exécute à `t+1` ; ton signal doit être connu **à la clôture de t** |
| **Remplissage arrière** | `fillna(method="bfill")`, `interpolate()` | `ffill()` seulement, et compte les trous |
| **Extremum futur** | `close / close.max()`, `idxmin()` sur toute la série | `rolling(n).max()` |
| **Resample mal borné** | `resample("1D")` avec `label="right"` sans `closed="right"` | fixe les deux, explicitement |
| **Tri absent** | index non trié : `rolling` mélange les époques | `sort_index()` dès le chargement |
| **Univers choisi aujourd'hui** | backtester 2022 sur les actifs liquides de 2026 | le dire ; univers défini à chaque date si possible |
| **Paramètre calé sur tout l'historique** | choisir `slow=40` parce que c'est le meilleur sur 2022-2026, puis « tester » sur 2022-2026 | calibrer en in-sample, ne regarder l'out-of-sample qu'une fois |

## Les deux fuites qu'aucun test ne détecte

1. **La fuite par les yeux.** Tu as regardé le graphique complet avant d'écrire la règle : « acheter les creux de juin » n'est pas causal, même si le code l'est. Décris la règle avant de regarder la période de test.
2. **La fuite par itération.** Cinquante variantes essayées sur les mêmes données : l'information de l'out-of-sample a fui par toi. La seule protection est de compter K honnêtement (`budget-de-parametres`) et de déflater (`validation-statistique`).

## Ce qui doit figurer dans le rapport

> **Causalité** : test sur 30 coupes aléatoires — aucune divergence. Aucune normalisation globale, aucun `center=True`, index trié, `ffill` seul (14 trous comblés sur 8 760 bougies, listés). Univers fixé à l'avance (BTCUSDT, ETHUSDT), sélectionné pour la liquidité en 2022 — biais de survie résiduel signalé.

## Lié

- `controle-qualite-donnees` : à faire avant, sur les données elles-mêmes.
- `pieges-pandas` : les idiomes qui produisent ces fuites.
- `backtest-python`, `validation-statistique` : la suite du protocole.
