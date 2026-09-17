---
name: specification-executable
description: À ouvrir dès qu'une stratégie doit être écrite — le gabarit à champs obligatoires, le test « est-ce codable », et les formulations vagues à refuser
---

# Une stratégie qui ne se code pas n'existe pas

Ton défaut ici est spécifique : tu écris de la **prose de stratégie**. « Entrer quand la tendance s'inverse avec confirmation du volume, sortir quand le momentum s'épuise » se lit très bien et ne se code pas. Personne ne peut la tester, donc personne ne peut savoir si elle perd de l'argent.

**Règle : chaque champ ci-dessous est rempli par une condition que `signal(df)` peut évaluer sur une bougie donnée. Si un champ ne se code pas, la stratégie n'est pas finie.**

## Le gabarit

```markdown
## <nom de la stratégie>

**Intuition** : la raison économique de l'avantage, en une phrase. Pourquoi
quelqu'un est prêt à perdre de l'argent en face ?

**Univers** : BTCUSDT, ETHUSDT (perp USDT-M). Pourquoi ceux-là.
**Pas de temps** : 4 h. Périodes/an : 2 190.
**Direction** : long seulement / long-short.

**Entrée** : condition exacte, évaluée à la clôture de la bougie t,
exécutée à l'ouverture de t+1.
  ex. close > MM200(close) ET MM20(close) > MM50(close)

**Sortie** : condition exacte, même règle d'exécution.
  ex. MM20 < MM50, OU stop touché, OU 30 bougies écoulées

**Stop** : distance en prix, calculable à l'entrée.
  ex. 2 × ATR(14) sous le prix d'entrée

**Taille** : règle, pas un chiffre.
  ex. risque 1 % du capital / distance au stop, notionnel ≤ 3× capital

**Filtre de régime** : quand la stratégie ne trade pas.
  ex. pas de position si ATR(14)/close > 6 % (volatilité extrême)

**Coûts retenus** : frais 6 bp/côté, slippage 5 bp/côté, funding réel.

**Invalidation** : ce qui fait abandonner la stratégie — pas un mauvais mois,
un critère précis.
  ex. drawdown > 1,5 × le drawdown max du backtest, ou 6 mois sans nouveau
  plus-haut de capital
```

## Le test « est-ce codable »

Pour chaque condition, pose-toi : **sur la bougie t, avec seulement les données ≤ t, puis-je répondre oui ou non ?** Si la réponse demande un jugement, ce n'est pas une règle.

| Prose (refusée) | Règle (acceptée) |
|---|---|
| « quand la tendance s'inverse » | `MM20 croise au-dessus de MM50` |
| « avec confirmation du volume » | `volume > 1,5 × MM20(volume)` |
| « quand le momentum s'épuise » | `RSI(14) < 50 après avoir dépassé 70` |
| « près d'un support » | `close < 1,01 × plus-bas des 20 dernières bougies` |
| « si le marché est favorable » | `close > MM200` |
| « prendre des profits progressivement » | `sortir 50 % à +2R, le reste au stop suiveur de 1 ATR` |

## Ce qui est interdit dans une condition

- **Une donnée future** : le close de la bougie du signal pour l'exécution, un plus-haut « des 20 prochaines bougies », une moyenne centrée. Voir `anti-fuite`.
- **Un paramètre non déclaré** : tout seuil chiffré est un paramètre, il compte dans le budget (`budget-de-parametres`).
- **Une condition sur un actif dont tu n'as pas les données.**

## Ensuite

Une spécification complète se traduit en un fichier de stratégie de dix lignes, puis se teste :

```python
# strategies/tendance_4h.py
import pandas as pd

def signal(df: pd.DataFrame, fast: int = 20, slow: int = 50, regime: int = 200) -> pd.Series:
    c = df["close"]
    tendance = c > c.rolling(regime).mean()
    croise = c.rolling(fast).mean() > c.rolling(slow).mean()
    return (tendance & croise).astype(float)

def stop_distance(df: pd.DataFrame, atr: int = 14) -> pd.Series:
    return 2 * (df["high"] - df["low"]).rolling(atr).mean()
```

puis `Backtest(data=…, strategy="strategies/tendance_4h.py", periods_per_year=2190)`.

Tant que la spécification n'est pas testée, tu ne dis pas qu'elle « devrait bien fonctionner » : tu dis qu'elle est prête à être testée.

## Lié

- `conception-strategie` : la démarche d'ensemble.
- `budget-de-cout` : l'avantage doit couvrir les frictions.
- `budget-de-parametres` : combien de seuils on s'autorise.
- `plan-backtest`, `anti-fuite` : la mise à l'épreuve.
