---
name: macro-conventions
description: À ouvrir dès qu'un indicateur macro entre dans l'analyse — CPI, emploi, taux, liquidité : quelle variante on lit, dans quelle unité, et quel effet usuel sur la crypto (avec ses contre-exemples)
---

# Lire la macro sans la déformer

Tes erreurs macro ne sont pas des erreurs de raisonnement : ce sont des confusions de variante et d'unité. Cœur ou total, mensuel ou annuel, nominal ou réel, niveau ou variation — se tromper de colonne inverse la conclusion.

## Les indicateurs et leurs pièges

| Indicateur | Ce qu'on lit | Piège classique |
|---|---|---|
| **CPI / inflation** | l'écart à l'attendu, sur le **cœur** (hors énergie et alimentation) et sur le total, en m/m **et** a/a | un a/a qui baisse avec un m/m qui accélère : la désinflation est terminée. L'a/a seul est en retard d'un an |
| **Emploi (NFP, chômage)** | créations + révisions des mois précédents + salaires | les révisions changent souvent le sens de la publication ; le chômage et les créations peuvent aller dans le même sens (participation) |
| **Taux directeurs** | ce qui est **déjà anticipé** par le marché à terme, pas le niveau | une baisse de taux attendue depuis trois mois est déjà dans les prix : la surprise compte, pas la décision |
| **Rendements réels** | nominal − inflation anticipée | un nominal qui monte avec une inflation qui monte plus vite est un assouplissement, pas un resserrement |
| **DXY / dollar** | la variation, pas le niveau | « DXY à 104 » ne dit rien ; « +2 % en deux semaines » dit quelque chose |
| **Liquidité globale** | bilan des banques centrales, reverse repo, réserves | mélanger les zones ; les rythmes sont mensuels, pas journaliers |
| **Flux ETF** | net, cumulé, et rapporté au volume du marché | un flux brut sans dénominateur n'est pas interprétable |

## L'effet usuel sur la crypto — et pourquoi il casse

La chaîne habituelle : **inflation surprise à la hausse → taux réels attendus plus élevés → moins d'appétit pour le risque → crypto sous pression.** Et l'inverse.

Trois raisons pour lesquelles cette chaîne échoue régulièrement, à vérifier avant de l'invoquer :

1. **La corrélation n'est pas stable.** La crypto suit les actions technologiques par périodes, puis s'en détache. Chiffre la corrélation sur la fenêtre récente avant de raisonner « actif à risque ».
2. **Les flux propres dominent souvent.** ETF, halving, liquidations, événement de protocole : l'endogène écrase le macro sur les horizons courts.
3. **Le régime commande.** En phase d'aversion extrême, tout descend ensemble et les nuances macro disparaissent.

Donc : la lecture macro entre dans l'analyse comme **contexte et calendrier**, pas comme mécanisme de prévision à court terme.

## Le calendrier, sans base de données

Tu n'as pas d'outil de calendrier économique. Ce que tu peux faire, honnêtement :

- Les **dates connues par construction** (réunions de banques centrales, publications mensuelles) se cherchent sur le web, datées et attribuées (`WebSearch`, `WebFetch`).
- Ce qui est **dans les données BytNode** (`get_market_indicators`, familles macro que `get_system_info` liste) prime, parce que c'est mesuré.
- Ce que tu ne peux pas vérifier, tu ne l'affirmes pas : « je ne connais pas la date exacte de la prochaine publication CPI, je peux la chercher ».

Et jamais de date de mémoire : une réunion de banque centrale « le 18 » sortie de ta mémoire est une invention (`horodatage`).

## La forme dans le rapport

Deux à quatre lignes, jamais un cours d'économie :

> **Macro** : inflation cœur à 0,3 % m/m contre 0,2 % attendu (as-of …, source …) ; le marché à terme réduit la probabilité de baisse de taux à 35 % (contre 55 % il y a un mois). Contexte défavorable au risque, mais la corrélation BTC/Nasdaq sur 30 j est de 0,31 : l'effet direct est faible en ce moment.

## Lié

- `contexte-macro` : la place de la macro dans l'analyse.
- `piege-de-la-narration` : la macro est le premier fournisseur de fausses causes.
- `citer-ou-se-taire` : une date ou un consensus se cite, ne se devine pas.
