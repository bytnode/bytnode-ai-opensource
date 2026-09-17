---
name: controle-qualite-donnees
description: À ouvrir dès qu'un CSV de marché arrive, avant toute modélisation — le script de contrôle (trous, doublons, sauts, volumes nuls, cohérence OHLC) et ce qu'on fait de chaque anomalie
---

# Regarde les données avant de les modéliser

Tu passes directement au modèle. Personne ne vérifie l'historique, et une seule bougie aberrante — un trou de dix heures, un prix à zéro, un doublon d'horodatage — suffit à produire un signal fantôme, un Sharpe inventé, un drawdown manquant.

**Règle : le contrôle ci-dessous tourne sur chaque fichier, et son résumé figure dans le rapport. Une anomalie non expliquée interdit de conclure.**

## Le contrôle

```python
import pandas as pd, numpy as np

def controle(csv: str, pas: str = "4h") -> None:
    df = pd.read_csv(csv, parse_dates=["time"]).set_index("time").sort_index()
    print(f"{len(df)} lignes — {df.index[0]} → {df.index[-1]}")

    # 1. doublons d'horodatage
    dup = df.index.duplicated().sum()
    print(f"doublons : {dup}")

    # 2. trous par rapport a la grille attendue
    grille = pd.date_range(df.index[0], df.index[-1], freq=pas, tz=df.index.tz)
    manquants = grille.difference(df.index)
    print(f"trous : {len(manquants)} sur {len(grille)} attendus"
          + (f" — du {manquants[0]} au {manquants[-1]}" if len(manquants) else ""))

    # 3. coherence OHLC
    mal = ((df["high"] < df[["open", "close"]].max(axis=1)) |
           (df["low"] > df[["open", "close"]].min(axis=1)) |
           (df["high"] < df["low"])).sum()
    print(f"OHLC incoherents : {mal}")

    # 4. valeurs impossibles
    print(f"prix <= 0 : {(df[['open','high','low','close']] <= 0).any(axis=1).sum()}"
          f" — NaN : {int(df.isna().sum().sum())}"
          f" — volume nul : {(df.get('volume', pd.Series(1, index=df.index)) == 0).sum()}")

    # 5. sauts anormaux
    r = df["close"].pct_change()
    z = (r - r.mean()) / r.std()
    extremes = r[z.abs() > 8]
    print(f"sauts > 8 sigma : {len(extremes)}")
    for t, v in extremes.items():
        print(f"   {t} : {100*v:+.1f} %")

    # 6. prix plat (marche gele / donnee repetee)
    plat = (r == 0).rolling(12).sum().max()
    print(f"plus longue serie de bougies sans variation : {int(plat or 0)}")
```

## Ce qu'on fait de chaque anomalie

| Anomalie | Décision |
|---|---|
| **Doublons** | garder la dernière (`~df.index.duplicated(keep="last")`) ; si les valeurs diffèrent, le dire |
| **Trous courts** (1-2 bougies) | `ffill` sur les prix, `0` sur le volume, et **compter** les bougies comblées |
| **Trous longs** (> 6 bougies) | ne pas combler : couper l'historique ou traiter les segments séparément. Un `ffill` sur dix heures crée un faux prix plat, donc une fausse volatilité basse |
| **OHLC incohérents** | supprimer ces lignes, les compter ; au-delà de 0,1 %, changer de source |
| **Saut > 8 σ** | vérifier à la main : vraie dislocation (à garder, c'est le marché) ou erreur de donnée (à supprimer). Ne jamais écrêter en silence |
| **Volume nul** | souvent un arrêt de cotation : exclure des calculs de volume, ne pas exclure du prix |
| **Prix plat prolongé** | symptôme d'un `ffill` déjà appliqué en amont ou d'un marché gelé : suspect, à signaler |

## Deux pièges propres à la crypto

- **La bougie en cours** est incomplète : retire-la avant tout calcul (`horodatage`).
- **Les rebases et changements de contrat** (redénominations, migrations de ticker) produisent un saut qui n'est pas un mouvement de marché. Un saut > 8 σ isolé sur un altcoin, c'est souvent ça.

## Le résumé à citer

> **Données** : `data/btc_4h.csv`, 8 742 bougies du 2022-01-01 au 2026-09-12 (grille attendue 8 760, **18 trous** dont 16 isolés comblés par `ffill` et un trou de 2 bougies le 2024-03-05 conservé tel quel). 0 doublon, 0 OHLC incohérent, 3 sauts > 8 σ vérifiés (dislocations réelles : 2024-08-05, 2025-02-03, 2025-10-10). Bougie en cours exclue.

Un rapport sans ce paragraphe n'est pas un rapport quantitatif.

## Lié

- `anti-fuite` : le contrôle suivant, sur le signal.
- `pieges-pandas` : les idiomes de nettoyage qui ne fuient pas.
- `source-bytnode` : `SaveMarketData` pour obtenir le fichier.
