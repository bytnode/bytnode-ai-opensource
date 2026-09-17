---
name: piege-de-la-narration
description: À ouvrir avant d'expliquer un mouvement de prix — comment vérifier qu'il y a quelque chose à expliquer, produire l'explication concurrente, et ne pas transformer une coïncidence en cause
---

# Tu fabriques des causes

C'est ta faiblesse la plus utile à connaître : donne-moi n'importe quel mouvement de prix et une liste d'actualités, je produirai une explication cohérente — dans les deux sens. « BTC baisse **parce que** les taux montent » et « BTC monte **malgré** la hausse des taux » se rédigent aussi bien l'une que l'autre. Cette facilité n'est pas de l'analyse : c'est de la narration, et elle donne à l'utilisateur une fausse impression de comprendre.

Trois garde-fous, dans l'ordre.

## 1. Y a-t-il quelque chose à expliquer ?

Avant toute cause, mesure l'anormalité du mouvement. Un −3 % sur un actif dont l'écart-type journalier est de 3 % est du bruit : il n'a pas de cause identifiable, et lui en chercher une est l'erreur.

```python
import pandas as pd
df = pd.read_csv("data/btc_1d.csv", parse_dates=["time"]).set_index("time")
r = df["close"].pct_change()
z = (r.iloc[-1] - r.tail(90).mean()) / r.tail(90).std()
print(f"variation {100*r.iloc[-1]:.2f} % — z = {z:.2f} sur 90 j")
```

| |z| | Ce que tu écris |
|---|---|
| < 1 | « dans la volatilité habituelle » — pas d'explication causale |
| 1 à 2 | « mouvement notable mais pas exceptionnel » — hypothèses au conditionnel |
| > 2 | « mouvement anormal » — là, cherche, et compte combien de fois c'est arrivé sur un an |

## 2. L'explication concurrente

Quand tu avances une cause, tu en avances **deux**, et tu dis comment on les distingue par une observation.

> La hausse s'accompagne d'un volume élevé. Deux lectures : accumulation (les acheteurs absorbent l'offre) ou distribution (les vendeurs écoulent dans la force). On distingue par le funding et l'open interest : une accumulation laisse le funding neutre et l'OI monter ; une distribution se voit à un funding qui s'emballe puis retombe.

Trois candidats à ne jamais oublier, parce qu'ils expliquent la majorité des mouvements sans aucune actualité :

- **Le flux mécanique** : liquidations en cascade, expiration d'options, rééquilibrage.
- **La corrélation** : l'actif suit BTC, ou BTC suit les actions technologiques. Vérifie-le avant d'inventer une cause propre.
- **Rien** : la liquidité était mince (week-end, heures creuses), un ordre de taille moyenne a suffi.

## 3. Ce qui interdit de dire « à cause de »

- **L'ordre chronologique n'est pas une preuve.** Si la nouvelle est tombée *après* le mouvement, elle ne l'explique pas. Compare les horodatages, à la minute (`horodatage`).
- **Un précédent unique n'est pas une régularité.** « La dernière fois que le funding était à ce niveau, le prix a chuté » : combien de fois le funding a-t-il atteint ce niveau sur deux ans, et dans quelle proportion des cas le prix a-t-il chuté ? Voir `taux-de-base`.
- **Une corrélation se chiffre.** Si tu invoques un lien avec les taux, l'or ou le Nasdaq, donne le coefficient et la fenêtre — sinon c'est une impression.

## La forme

> **Fait** : ETHUSDT −4,8 % en 24 h (as-of …). z = −2,3 sur 90 j : anormal, arrivé 6 fois en un an.
> **Lecture principale** : … parce que … — ce qui l'appuie : …
> **Lecture concurrente** : … — ce qui la distinguerait : …
> **Ce qui n'explique pas** : la publication de 14 h 30, postérieure au mouvement.
> **Incertitude** : forte, l'échantillon est de 6 cas.

## Lié

- `taux-de-base` : la fréquence historique avant l'interprétation.
- `fenetre-honnete` : ne pas choisir l'horizon qui arrange.
- `contradiction-obligatoire` : la même discipline appliquée à la thèse de l'utilisateur.
