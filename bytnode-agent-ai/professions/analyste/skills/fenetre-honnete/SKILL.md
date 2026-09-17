---
name: fenetre-honnete
description: À ouvrir avant de qualifier une tendance — le tableau multi-horizons obligatoire, pourquoi la fenêtre se fixe avant la conclusion, et comment traiter un désaccord entre horizons
---

# La fenêtre se choisit avant la conclusion, pas après

Sur les mêmes données, « BTC est en forte hausse » et « BTC est en tendance baissière » sont toutes les deux vraies — il suffit de regarder 7 jours ou 6 mois. Ton biais : tu formes une impression, puis tu retiens l'horizon qui la confirme. L'utilisateur n'a aucun moyen de le voir.

**Règle : le tableau multi-horizons est calculé et affiché avant que tu ne qualifies quoi que ce soit.**

## Le tableau

Toujours les mêmes colonnes, dans le même ordre, même quand un horizon dérange.

| Horizon | Variation | Position dans le canal |
|---|---:|---|
| 24 h | … | |
| 7 j | … | |
| 30 j | … | |
| 90 j | … | |
| 1 an | … | |

```python
import pandas as pd
df = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time").sort_index()
c = df["close"]
for label, n in [("24 h", 1), ("7 j", 7), ("30 j", 30), ("90 j", 90), ("1 an", 365)]:
    if len(c) > n:
        print(f"{label:>5} : {100*(c.iloc[-1]/c.iloc[-1-n]-1):+7.2f} %")
print(f"position 1 an : {100*(c.iloc[-1]-c.tail(365).min())/(c.tail(365).max()-c.tail(365).min()):.0f} % du canal")
```

Si l'historique est trop court pour un horizon, écris-le (« 1 an : historique insuffisant ») — ne le supprime pas de la ligne.

## Quand les horizons se contredisent

C'est le cas le plus fréquent, et c'est une information, pas un problème à résoudre. Nomme-le :

> Hausse de 6 % sur 7 j **dans** une baisse de 18 % sur 90 j : rebond à l'intérieur d'une tendance baissière. Tant que le prix reste sous la MM200, la lecture de fond reste baissière.

Une tendance se qualifie sur un horizon **nommé** : « haussier à 7 jours », jamais « haussier » tout court.

## Le point de départ

Une variation dépend autant de son point de départ que de son point d'arrivée. Deux précautions :

- **Ne fais pas partir la fenêtre d'un extrême.** « +140 % depuis le plus bas » est vrai et trompeur : le plus bas a été choisi après coup. Donne aussi la variation depuis une date fixe (début d'année, il y a un an).
- **Les dates rondes ne sont pas neutres** : « depuis le début du mois » peut couvrir trois jours. Affiche la durée réelle.

## Ce qui remplace « fortement »

Les adverbes sont ton échappatoire : « fortement », « nettement », « légèrement » n'ont pas de définition. Remplace-les par une comparaison chiffrée : « +6 % en 7 j, soit 1,8 écart-type de la variation hebdomadaire sur un an ». Voir `taux-de-base`.

## Lié

- `taux-de-base` : à quoi comparer pour savoir si c'est « fort ».
- `piege-de-la-narration` : ne pas expliquer un mouvement qui est du bruit.
