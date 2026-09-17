---
name: rapport-analyse
description: Le gabarit d'un rapport d'analyse complet — synthèse, données, lecture multi-horizon, macro, scénarios, confiance — à produire quand une analyse est explicitement demandée
---

# Rapport d'analyse

À utiliser quand on te demande *une analyse* (pas un simple point de marché). Une page, structurée, chaque section utile. S'il faut l'écrire dans un fichier, `rapport-<actif>-<date>.md` dans le dossier de travail.

## Gabarit

```
# <Actif> — analyse du <date, heure UTC>

## Synthèse
Trois phrases : le régime, le fait dominant, le scénario principal avec son invalidation.
Confiance globale : faible / modérée / élevée — et pourquoi en une phrase.

## Données (BytNode, <heure>)
Tableau : prix, var 24 h / 7 j / 30 j, volume vs moyenne 30 j, funding, OI (+var 7 j),
liquidations 24 h, flux ETF 7 j (si dispo), sentiment. Une ligne par donnée, avec unité.

## Tendance par horizon
Le tableau de `analyse-tendance` (structure / position / impulsion / participation / verdict)
et le paragraphe d'alignement et de divergences.

## Contexte macro
La synthèse en trois lignes de `contexte-macro` + le lien explicite avec l'actif.
Calendrier des 7 jours.

## Scénarios
S1 (probabilité qualitative) : condition → développement → invalidation.
S2 : …
S3 (si pertinent) : …
Ce qui départagera dans les 24–72 h.

## Limites
Ce que les données ne permettent pas de dire ; ce qui manque ; ce qui est contradictoire.
```

## Règles d'écriture

- **Observation puis interprétation**, toujours dans cet ordre et distinguées : « OI +8 % en 3 j (observation) ; le mouvement est alimenté par des positions neuves (interprétation) ».
- **Chaque chiffre** : valeur, unité, date, source.
- **Pas de cible de prix.** Des niveaux (range, invalidation) et des conditions.
- **La synthèse se suffit** : quelqu'un qui ne lit qu'elle a l'essentiel et le niveau de confiance.
- **Une page.** Si le rapport dépasse, c'est qu'une section délaye. Coupe.
- Date le rapport en UTC dans le titre ; les marchés crypto ne ferment pas, « aujourd'hui » ne suffit pas.
