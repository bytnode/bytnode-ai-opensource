# Vos compétences

Un dossier par compétence, avec un `SKILL.md` :

```
skills/
  analyse-funding/
    SKILL.md          ← obligatoire
    exemple.csv       ← ce que vous voulez : le dossier est copié en entier
```

Le `SKILL.md` commence par un en-tête :

```markdown
---
name: analyse-funding
description: Lire le funding d'un perpétuel et en déduire le positionnement — c'est cette ligne que l'agent lit pour décider s'il ouvre la compétence
---

# Analyse du funding

Les consignes, en markdown. Ce que l'agent doit faire, dans quel ordre,
ce qu'il doit éviter, la forme attendue de la réponse.
```

`description` est la seule ligne que l'agent voit en permanence : elle doit
dire **quand** ouvrir la compétence, pas seulement de quoi elle parle.

## Qui les voit

- **Tous les agents**, quel que soit leur accès aux modèles. La liste (nom +
  description) est dans leur prompt à chaque tour ; le corps est chargé quand
  ils en ont besoin.
- Les agents **par clé OpenRouter** les lisent ici même, par l'outil `Skill`.
- Les agents **par abonnement** (Claude, OpenAI, Gemini, Copilot, Grok,
  Mistral) en reçoivent une copie dans `.agents/skills/` et `.claude/skills/`
  de leur dossier de travail, où leurs propres mécanismes de skills les
  trouvent. La copie est refaite quand vous modifiez le `SKILL.md`, et une
  compétence retirée d'ici disparaît de leur dossier.

En cas de même nom, la compétence de la profession (`professions/<métier>/skills/`)
passe avant celle-ci.

## Les autres emplacements

- `professions/<métier>/skills/` — propre à un métier, livré avec l'application.
- `professions/_commun/skills/` — partagé par tous les métiers.
- `<dossier de travail>/skills/` — propre à un seul agent, écrit à la main.
- `~/.agents/skills/` — partagé avec vos autres outils.

Une compétence ajoutée pendant qu'une conversation est ouverte apparaît au
message suivant.
