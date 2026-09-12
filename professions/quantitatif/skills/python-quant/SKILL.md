---
name: python-quant
description: La façon de travailler en Python pour la recherche quantitative — structure d'un script d'expérience, chargement des données BytNode en pandas, contrôles de qualité, reproductibilité, exécution et sorties
---

# Python pour la recherche quantitative

## Environnement

- Vérifie d'abord : `python --version` et `python -c "import pandas, numpy, scipy, statsmodels, matplotlib"` (PowerShell ou Bash). Manque-t-il un paquet ? `pip install pandas numpy scipy statsmodels matplotlib` — et dis-le.
- Un script `.py` par expérience, dans le dossier de travail, sous `research/` ; les données brutes sous `data/`, les sorties sous `out/`. Un notebook seulement si on te le demande (NotebookEdit).

## Structure d'un script d'expérience

```python
"""exp_<nom>.py — <hypothèse en une phrase>."""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np, pandas as pd

# --- Paramètres, en tête, tous nommés ---
ASSET = "BTC"; TIMEFRAME = "1d"; LOOKBACK = 20; SEED = 42
OUT = Path("out") / "exp_<nom>"; OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(SEED)

def load(asset: str, timeframe: str) -> pd.DataFrame:
    """Lit data/<asset>_<timeframe>.csv écrit depuis BytNode (voir ci-dessous)."""
    df = pd.read_csv(f"data/{asset}_{timeframe}.csv", parse_dates=["ts"]).set_index("ts").sort_index()
    return check(df)

def check(df: pd.DataFrame) -> pd.DataFrame:
    assert df.index.is_unique, "doublons d'horodatage"
    assert df.index.tz is not None, "index sans fuseau : attendu UTC"
    gaps = df.index.to_series().diff().value_counts()
    if len(gaps) > 1: print("trous dans la série :", gaps.head(), file=sys.stderr)
    assert (df[["open","high","low","close"]] > 0).all().all(), "prix non positifs"
    return df

def main() -> None:
    df = load(ASSET, TIMEFRAME)
    # ... calculs ...
    results = {"n": len(df), "...": ...}
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
```

## Les données BytNode → CSV

BytNode se lit par tes outils (`get_history`, `get_market_data`…), pas depuis Python. La chaîne :
1. Appelle `get_history` pour l'actif, le pas de temps et la période ; la réponse est du texte/JSON.
2. Écris-la avec `Write` en `data/<asset>_<timeframe>.csv` (colonnes `ts,open,high,low,close,volume`, et `funding`, `oi` si présents ; `ts` en ISO 8601 UTC).
3. Le script lit le CSV. Note dans `out/…/results.json` la date de récupération et les bornes de la série.
Si l'historique demandé dépasse ce que BytNode rend en un appel, découpe par périodes et concatène ; vérifie l'absence de doublons au raccord.

## Règles

- **Tout en UTC**, index `DatetimeIndex` tz-aware. Les rendements en log (`np.log(close).diff()`) pour l'agrégation, en simple pour l'affichage.
- **Pas de fuite du futur** : tout signal à t n'utilise que des données ≤ t ; les `rolling` sont causaux par défaut, `shift(1)` avant d'agir sur le signal.
- **Vectorise** ; une boucle Python sur les bougies n'est acceptable que pour un backtest événementiel explicite.
- **Reproductible** : graine fixée, paramètres en tête, versions imprimées (`pd.__version__`).
- **Montre** : exécute le script, colle la sortie ; enregistre les figures en PNG dans `out/` et lis-les avec Read pour les commenter.
- Une expérience = une question. Si tu en as trois, trois scripts.
