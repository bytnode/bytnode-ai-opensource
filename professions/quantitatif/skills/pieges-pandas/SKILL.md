---
name: pieges-pandas
description: À ouvrir en écrivant du pandas sur des séries temporelles de marché — les idiomes exacts pour resample, alignement, décalage, fuseaux, flottants, et les tournures qui produisent des résultats faux sans erreur
---

# Les idiomes qui ne mentent pas

Tes erreurs pandas ne lèvent pas d'exception : elles décalent une série d'une bougie, alignent mal deux actifs, ou comparent deux flottants. Le code tourne, le résultat est faux. Voici les tournures à utiliser, et celles à ne jamais écrire.

## Le chargement, une fois pour toutes

```python
import pandas as pd

df = (pd.read_csv("data/btc_4h.csv", parse_dates=["time"])
        .set_index("time")
        .sort_index())                       # ⚠️ sans tri, rolling mélange les époques
df = df[~df.index.duplicated(keep="last")]
if df.index.tz is None:
    df.index = df.index.tz_localize("UTC")   # tout en UTC, toujours
```

Si le temps est numérique : `pd.to_datetime(t, unit="ms" if t.iloc[0] > 1e11 else "s", utc=True)`.

## Resample : les quatre arguments qui comptent

```python
j = df.resample("1D", label="left", closed="left", origin="epoch").agg(
    {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
)
```

- `label` : quel horodatage porte la période. `left` = la période est nommée par son début — la convention des bougies.
- `closed` : quel bord est inclus. **`label` et `closed` doivent être cohérents**, sinon la bougie est décalée d'une période.
- `origin="epoch"` : sinon la grille dépend de la première ligne du fichier et deux actifs ne s'alignent plus.
- Le dernier groupe est **partiel** : `j = j.iloc[:-1]` si tu ne veux que des périodes complètes.

## Décalages et fenêtres

```python
c = df["close"]
c.shift(1)                      # la valeur précédente — causal
c.shift(-1)                     # ⛔ le futur : jamais dans un signal
c.rolling(20).mean()            # causal, NaN sur les 19 premières
c.rolling(20, center=True)      # ⛔ utilise le futur
c.rolling(20, min_periods=1)    # ⚠️ moyenne sur 3 points au début : évite, garde les NaN
c.ewm(span=20, adjust=False)    # exponentielle causale
c.diff(), c.pct_change()        # décalage de 1 par défaut
```

Les NaN du début sont une **information** : ils disent que l'indicateur n'existe pas encore. Les remplir (`fillna(0)`, `bfill`) crée des signaux fantômes au début de l'historique.

## Aligner deux actifs

```python
a = charge("data/btc_4h.csv")["close"].rename("btc")
b = charge("data/eth_4h.csv")["close"].rename("eth")
paire = pd.concat([a, b], axis=1, join="inner")      # inner : seules les dates communes
corr = paire["btc"].pct_change().rolling(90).corr(paire["eth"].pct_change())
```

`join="outer"` (le défaut de `concat`) fabrique des NaN, qu'un `ffill` transforme ensuite en faux prix. Pour une corrélation, `inner` est le seul choix honnête — et dis combien de lignes ont été perdues.

⛔ `a.corr(b)` sur les **prix** : deux séries qui montent sont corrélées à 0,99 sans rien dire. La corrélation se calcule sur les **rendements**.

## Les flottants

```python
import numpy as np
if np.isclose(a, b): ...          # ✅
if a == b: ...                    # ⛔ sur des flottants
croise = (f > s) & (f.shift(1) <= s.shift(1))    # un croisement, proprement
```

## Les tournures à bannir

| ⛔ | ✅ | Pourquoi |
|---|---|---|
| `df.append(...)` | `pd.concat([...])` | retiré de pandas 2 |
| `df["x"][df.y > 0] = 1` | `df.loc[df.y > 0, "x"] = 1` | affectation en chaîne : silencieusement sans effet |
| `inplace=True` | réassigner | comportement ambigu, déconseillé en amont |
| `iterrows()` sur 10 000 lignes | opérations vectorisées | mille fois plus lent, et `r["close"]` perd le type |
| `df.dropna()` en fin de chaîne | `dropna(subset=[...])` | supprime des lignes pour une colonne annexe |
| `apply(lambda …)` par ligne | `np.where`, `.clip`, `.mask` | lent, et masque les erreurs de type |

## Le contrôle de forme

Après chaque transformation qui change la granularité ou joint des séries :

```python
print(len(df), df.index.is_monotonic_increasing, df.index.tz, df.isna().sum().to_dict())
```

Trois lignes qui font gagner des heures : longueur attendue, index trié, fuseau posé, NaN comptés.

## Lié

- `anti-fuite` : le test qui prouve qu'aucun de ces pièges n'a fui.
- `controle-qualite-donnees` : ce qu'on vérifie avant de transformer.
- `python-quant` : la démarche d'ensemble.
