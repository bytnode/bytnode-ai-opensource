---
name: budget-de-cout
description: À ouvrir avant de proposer une stratégie — chiffrer frais, slippage et funding par aller-retour, les comparer à l'avantage attendu, et refuser ce qui ne passe pas le seuil
---

# La plupart des stratégies proposées meurent sur les coûts

C'est l'erreur la plus fréquente et la plus silencieuse : une règle qui gagne 0,15 % par trade, avec 0,22 % de frictions par aller-retour, perd de l'argent — et rien dans le raisonnement ne le signale. Plus le pas de temps est court, plus c'est vrai.

**Règle : le budget de coût se calcule avant le premier backtest, et la stratégie est refusée si l'avantage brut attendu n'atteint pas deux fois le coût.**

## Le calcul

```python
FEE = 0.0006        # taker, par côté — valeur réelle de l'échange visé
SLIP = 0.0005       # par côté ; davantage sur altcoins ou en stress
FUNDING = 0.0001    # par période de 8 h, moyenne récente (signe selon le sens)

duree_h = 48        # durée moyenne de position visée
aller_retour = 2 * (FEE + SLIP)
cout_funding = FUNDING * (duree_h / 8)
cout_total = aller_retour + cout_funding
print(f"coût par trade : {100*cout_total:.3f} % "
      f"(frictions {100*aller_retour:.3f} % + funding {100*cout_funding:.3f} %)")
```

Puis, en face, l'avantage brut attendu par trade — **estimé avant le test**, à partir de l'amplitude visée et du taux de réussite espéré :

```python
taux_reussite, gain_moyen, perte_moyenne = 0.40, 0.030, 0.012   # en fraction
avantage = taux_reussite * gain_moyen - (1 - taux_reussite) * perte_moyenne
print(f"avantage brut : {100*avantage:.3f} % — ratio avantage/coût : {avantage/cout_total:.1f}×")
```

| Ratio avantage / coût | Verdict |
|---|---|
| < 1 | perdante par construction — on arrête ici |
| 1 à 2 | trop fragile : une hausse de slippage la tue. À refuser sauf argument fort |
| 2 à 4 | viable, à tester |
| > 10 | suspect : vérifie l'hypothèse d'amplitude, elle est probablement trop optimiste |

## Ce qu'on oublie systématiquement

- **Le funding sur les positions tenues.** À 0,01 % / 8 h, une position de 5 jours coûte 0,15 % — souvent plus que les frais. Sur un short, le funding positif te **paie** : le signe compte.
- **Le slippage réel, pas le théorique.** Il dépend de la taille par rapport au carnet, et il explose au moment précis où la stratégie veut agir (volatilité, liquidations). Double-le pour un test de robustesse.
- **Les stops sont des ordres marché.** Un stop touché paie le slippage, souvent pire que la moyenne.
- **La fréquence.** Une stratégie qui trade 300 fois par an paie 300 aller-retours : à 0,22 %, c'est 66 % de capital consommé en frictions. Le nombre de trades est un paramètre de conception, pas une conséquence.
- **Les altcoins.** Sur les paires moins liquides du périmètre, prends le double des frictions de BTC.

## Le test de sensibilité obligatoire

Après le backtest, relance avec **le double de frais et de slippage**. Si le résultat se retourne, la stratégie n'est pas viable — elle vivait de l'hypothèse de coût.

```
Backtest(..., fee=0.0006, slippage=0.0005)   # référence
Backtest(..., fee=0.0012, slippage=0.0010)   # stress
```

Les deux tableaux vont dans le rapport, côte à côte.

## La forme dans la proposition

> **Budget de coût** : 0,22 % de frictions par aller-retour + 0,06 % de funding (48 h à 0,01 %/8 h) = **0,28 % par trade**. Avantage brut estimé : 0,77 % (40 % de réussite, +3,0 % / −1,2 %). Ratio 2,8× — viable, à tester. Sous stress (frais et slippage doublés), le ratio tombe à 1,5× : la marge est mince, la fréquence devra rester basse.

## Lié

- `conventions-marche` : funding, bp, mark et liquidation.
- `specification-executable` : les coûts sont un champ de la spécification.
- `plan-backtest` : où le test de stress se place.
