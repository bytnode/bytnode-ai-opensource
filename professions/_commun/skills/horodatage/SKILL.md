---
name: horodatage
description: À ouvrir avant de citer un prix, une variation ou un indicateur — quelle heure il est vraiment, pourquoi la bougie en cours ne compte pas, et pourquoi un prix de mémoire est toujours faux
---

# Le temps, et pourquoi tu te trompes dessus

Deux erreurs, systématiques :

1. **Tu as une date de coupure.** Les prix, capitalisations, taux et « derniers événements » que tu crois connaître datent d'avant. Un prix de mémoire n'est pas une approximation : c'est un chiffre faux présenté avec assurance.
2. **Tu ne sais pas quelle heure il est.** L'utilisateur dit « aujourd'hui », toi tu n'as pas d'horloge. Tu l'obtiens par un outil, pas par déduction.

## La règle

Tout chiffre de marché vient d'un appel, dans ce tour de conversation. Aucun prix, aucune variation, aucun niveau « de mémoire » — même pour un ordre de grandeur, même pour illustrer.

Chaque chiffre porte son **as-of** : l'instant auquel il était vrai.

> BTCUSDT — 111 240 USDT (as-of 2026-09-12 08:00 UTC, bougie 4 h close).

## L'heure courante

```bash
python -c "import datetime; print(datetime.datetime.now(datetime.UTC).isoformat(timespec='seconds'))"
```

Tout en **UTC**. Les marchés crypto ne ferment pas : il n'y a pas d'« heure de clôture » à respecter, donc pas de raison d'utiliser un fuseau local — et deux séries dans deux fuseaux différents produisent un décalage silencieux d'une bougie.

## La bougie en cours

La dernière bougie renvoyée par un historique est **en train de se former** : son `close` est le prix actuel, son `high`, son `low` et son `volume` sont partiels. Elle bougera encore.

- Pour un calcul (moyenne, indicateur, backtest) : exclue. Une bougie incomplète fausse le dernier point de tout indicateur.
- Pour un prix courant : utilisable, en disant qu'elle est en cours.
- Pour une variation « sur 24 h » : dis sur quoi elle porte — dernières 24 h glissantes, ou dernier jour clos.

## Les périodes

Sois explicite, toujours : « du 2026-08-13 au 2026-09-12 (30 jours) », pas « sur le dernier mois ». Un mois, un trimestre, « depuis le début de l'année » : ces bornes se calculent, elles ne s'estiment pas.

Attention aux périodes partielles : annualiser une performance sur onze jours donne un nombre spectaculaire et vide de sens. Dis la durée réelle à côté.

## Ce qui change vite, ce qui change lentement

| Donnée | Durée de validité |
|---|---|
| Prix, carnet, funding courant | secondes à minutes |
| Open interest, liquidations, sentiment | minutes à heures |
| Indicateurs techniques journaliers | jusqu'à la prochaine clôture |
| Publications macro | jusqu'à la publication suivante (calendrier connu) |

Si une conversation dure, un prix cité il y a vingt minutes est périmé pour une décision : rappelle-le ou relis-le.

## Lié

- `calcul-verifie` : comment calculer une variation sans se tromper.
- `citer-ou-se-taire` : la forme dans laquelle un chiffre horodaté se présente.
