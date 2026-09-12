---
name: calcul-verifie
description: À ouvrir dès qu'un chiffre doit apparaître dans la réponse — variation, moyenne, annualisation, points de base, taille de position : comment le calculer en l'exécutant plutôt que de tête, et le contrôler
---

# Aucun chiffre de tête

Tu es solide en raisonnement et faible en arithmétique : une variation en pourcentage, une composition sur douze mois, une annualisation, un enchaînement de deux opérations — c'est là que tu te trompes, et le chiffre faux passe inaperçu parce que le raisonnement autour est juste.

**Règle : tout nombre qui apparaît dans ta réponse sort soit d'un champ lu tel quel dans une réponse d'outil, soit d'un calcul que tu as exécuté.** Jamais d'un calcul mental.

## Comment exécuter

Un calcul court : une commande.

```bash
python -c "
a, b = 111_240.0, 103_820.0
print(f'variation {100*(a/b-1):.2f} %')
"
```

Une série, un tableau, plusieurs actifs : les données dans un fichier (`SaveMarketData`), puis pandas. Un backtest : l'outil `Backtest`, jamais un moteur maison.

Si tu ne peux pas exécuter (outil refusé, pas de Python), tu ne donnes pas le chiffre : tu dis ce qu'il faudrait calculer et tu proposes de le faire.

## Les formules qui se trompent le plus

| Ce qu'on veut | Formule | Piège |
|---|---|---|
| Variation | `(fin / debut - 1)` | −50 % puis +50 % ne revient pas au point de départ |
| Retour au point initial après −x | `1/(1-x) - 1` | −20 % exige +25 %, pas +20 % |
| Composition de n variations | `prod(1 + r_i) - 1` | jamais la somme |
| Annualiser un rendement sur p périodes/an | `(1 + r)**p - 1` | `r * p` est faux dès que r est grand |
| Annualiser une volatilité | `sigma * sqrt(p)` | `sigma * p` est faux |
| Points de base | `1 bp = 0,01 % = 0,0001` | 25 bp ≠ 0,25 bp |
| Funding 8 h → annualisé | `f * 3 * 365` | un funding « 0,01 % » est ~10,95 %/an |
| Moyenne de pourcentages | moyenne **géométrique** pour des rendements | la moyenne arithmétique surestime |
| Taille de position au risque r | `capital * r / distance_au_stop` | la distance est en prix, pas en % du capital |

## Le contrôle avant d'écrire

Trois questions, à chaque fois :

1. **Ordre de grandeur** : le résultat est-il plausible ? Un actif ne fait pas +4 000 % en une journée ; un Sharpe de 12 n'existe pas ; un drawdown ne dépasse pas −100 %.
2. **Unité et signe** : pourcentage ou fraction ? par jour ou par an ? long ou short ? Écris l'unité à côté du nombre dans le code même.
3. **Deux chemins** : pour un chiffre qui porte une conclusion, recalcule-le autrement (somme des parties vs total, ou deux fenêtres qui doivent coïncider).

## La précision affichée

N'affiche pas plus de précision que la donnée n'en porte. Un prix : la précision du marché. Un pourcentage : deux décimales. Un Sharpe : deux décimales. `0,0347281 %` est une fausse précision — écris `0,03 %`.

Arrondis **à la fin**, jamais en cours de calcul.

## Lié

- `horodatage` : d'où viennent les chiffres et à quelle heure.
- `citer-ou-se-taire` : comment les présenter.
