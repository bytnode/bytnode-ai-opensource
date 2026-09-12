---
name: backtest-python
description: Écrire un backtest vectorisé honnête en pandas — signal causal, exécution à la bougie suivante, frais, slippage, funding, métriques complètes, courbes — à partir d'une stratégie spécifiée
---

# Backtest en Python

**D'abord l'outil `Backtest`.** BytNode-AI a un moteur standard (exécution à la bougie suivante, frais + slippage, funding, taille par le risque, découpage in/out-of-sample, métriques par période et par année, référence acheter-et-garder, courbe de capital) : tu n'écris que le fichier de stratégie —

```python
# strategies/sma_cross.py
import pandas as pd

def signal(df: pd.DataFrame, fast: int = 10, slow: int = 50) -> pd.Series:
    """-1 / 0 / 1, calculé avec les données ≤ t (rolling causal)."""
    f = df["close"].rolling(fast).mean()
    s = df["close"].rolling(slow).mean()
    return (f > s).astype(float)          # long seulement ; (f > s) - (f < s) pour long/short

def stop_distance(df: pd.DataFrame, atr: int = 14) -> pd.Series:
    """Optionnel : distance au stop en prix (ici 2·ATR) → taille par le risque."""
    tr = (df["high"] - df["low"]).rolling(atr).mean()
    return 2 * tr
```

puis `Backtest(data="data/btc_4h.csv", strategy="strategies/sma_cross.py", params={"fast": 10, "slow": 50}, periods_per_year=2190)`. Les données viennent de `SaveMarketData`. Relance avec les paramètres ±20 % et ±50 % pour la sensibilité (`validation-statistique`).

Le squelette ci-dessous sert **seulement** quand la stratégie ne tient pas dans `signal` / `stop_distance` (pyramidage, stops intra-bougie, taille dépendant du capital courant) : alors, événementiel, à la main.

Pour une stratégie écrite avec `conception-strategie` et un plan `plan-backtest`. Vectorisé quand les règles le permettent (une position par actif, taille fixée au signal) ; événementiel (boucle) dès qu'il y a pyramidage, stops intra-bougie ou taille dépendant du capital courant.

## Squelette vectorisé

```python
import numpy as np, pandas as pd

FEE = 0.0006        # taker, par côté — valeur réelle de l'échange visé
SLIPPAGE = 0.0005   # par côté ; plus haut sur altcoins / en stress
RISK = 0.01         # risque par position, fraction du capital

def backtest(df: pd.DataFrame, signal: pd.Series, stop_dist: pd.Series) -> dict:
    """df : OHLCV (+ funding si perp), index UTC. signal ∈ {−1, 0, 1} calculé avec les données ≤ t.
    stop_dist : distance au stop en prix, au moment du signal (ex. 2·ATR)."""
    # Exécution à l'OUVERTURE de la bougie suivante : jamais à la bougie du signal.
    pos = signal.shift(1).fillna(0)
    px = df["open"]
    # Taille : risque fixe / distance au stop, bornée (levier notionnel max 3×).
    size = (RISK / (stop_dist.shift(1) / px)).clip(upper=3.0).fillna(0) * pos.abs()
    ret = px.pct_change().fillna(0)
    gross = pos * size * ret
    turnover = (pos * size).diff().abs().fillna(0)
    costs = turnover * (FEE + SLIPPAGE)
    funding = (df["funding"].fillna(0) * pos * size) if "funding" in df else 0
    net = gross - costs - funding
    equity = (1 + net).cumprod()
    return {"net": net, "equity": equity, "pos": pos, "size": size, "costs": costs}
```

Le stop intra-bougie n'est pas représentable en vectorisé : si la stratégie en dépend, passe en événementiel (boucle sur les bougies, état explicite : position, prix d'entrée, stop courant), et documente que les stops sont exécutés au **pire** de la bougie (`low` pour un long) — c'est la version conservatrice.

## Métriques (toutes)

```python
def metrics(net: pd.Series, equity: pd.Series, periods_per_year: int) -> dict:
    ann = periods_per_year
    mu, sd = net.mean() * ann, net.std(ddof=1) * np.sqrt(ann)
    downside = net[net < 0].std(ddof=1) * np.sqrt(ann)
    dd = equity / equity.cummax() - 1
    trades = (net != 0).astype(int).diff().eq(1).sum()  # approximation vectorisée : à remplacer par le vrai compte en événementiel
    return {
        "rendement_annualise": (equity.iloc[-1]) ** (ann / len(net)) - 1,
        "volatilite": sd, "sharpe": mu / sd if sd else np.nan,
        "sortino": mu / downside if downside else np.nan,
        "drawdown_max": dd.min(), "calmar": ((equity.iloc[-1]) ** (ann / len(net)) - 1) / abs(dd.min()) if dd.min() else np.nan,
        "exposition": (net != 0).mean(), "trades": int(trades),
        "plus_longue_serie_pertes": int((net < 0).astype(int).groupby((net >= 0).cumsum()).sum().max()),
    }
```

`periods_per_year` : 365 pour du journalier crypto (le marché ne ferme pas), 365×6 en 4 h, 365×24 en 1 h.

## Sorties obligatoires

- `out/<exp>/metrics.json` — le dictionnaire ci-dessus, **par période** (in-sample, out-of-sample, chaque année) et par régime.
- `out/<exp>/equity.png` — courbe de capital + drawdown, avec la référence acheter-et-garder.
- `out/<exp>/trades.csv` — en événementiel : entrée, sortie, R réalisé, durée.
- Le résumé imprimé dans la réponse : tableau des métriques par période, puis le verdict de `validation-statistique`.

## Pièges

- **Fuite du futur** : un `rolling(...).mean()` est causal ; un `rolling(..., center=True)` ne l'est pas ; une normalisation sur toute la série non plus.
- **Survivorship** : un univers d'altcoins choisi aujourd'hui exclut ceux qui sont morts. Le dire ; si possible, univers défini à chaque date.
- **Frais nuls** : un backtest sans frais sur un pas court n'est pas un backtest.
- **Un seul actif, une seule période** : pas une preuve — voir `validation-statistique`.
- **Le compte de trades** vectorisé est approximatif : si le nombre compte (il compte), passe en événementiel.
