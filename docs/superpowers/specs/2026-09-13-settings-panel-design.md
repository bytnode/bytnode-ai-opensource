# Panneau de réglages — design

**Date :** 2026-09-13 · **Statut :** approuvé

## But

Remplacer la feuille `Wizard` (étapes Profil → Authentification, ou Agent seul) par un panneau de réglages classique : navigation à gauche, contenu à droite, quatre sections. L'assistant `Wizard` reste réservé au premier démarrage (`app/page.tsx`).

## Sections

| Onglet | Contenu | Enregistrement |
| --- | --- | --- |
| Général | Profil (prénom, nom, email, à propos de vous) · Apparence (clair / sombre) | immédiat, champ par champ |
| Auth | Clé OpenRouter (Vérifier) · Clé BytNode (Vérifier) · Comptes exchange (Tester, Retirer, ajouter) | immédiat |
| Agents | Liste des agents (nom, profession, fournisseur, dossier, pastille RÉEL) · Nouvel agent · Modifier · Supprimer. Modifier / créer remplace la liste par le formulaire `StepAgent` avec « ← Agents » | formulaire : bouton « Créer l'agent » / « Enregistrer » (validation nom + fournisseur) |
| Fournisseurs | OpenRouter (clé enregistrée ou non → renvoie vers Auth) puis les six agents ACP : état Connecté · compte / Non connecté / Lecture… / À installer, action Se connecter / Déconnecter / Installer | actions immédiates |

## Comportement

- Ouverture : engrenage du sidebar → Général ; « Nouvel agent » → Agents en création ; crayon → Agents en édition ; bandeau « clé manquante » → Auth (OpenRouter) ou Fournisseurs (ACP).
- Sans aucun agent : panneau forcé sur Agents en création, sans fermeture.
- `authMode` n'est plus édité que par l'onboarding ; il sert seulement de source par défaut dans le formulaire d'agent.
- Suppression : confirmation existante (`ConfirmDialog`) au-dessus du panneau.

## Visuel

Tokens BytNode (`--ink`, `--paper`, `--voile`), Geist. Panneau `min(1040px, 100%) × min(720px, 100% − 32px)` sur le voile `.ob`, nav 220 px, contenu défilant seul. Chaque réglage est une ligne « libellé + aide | contrôle », séparée par `--line`, groupée sous un titre de section. Sous 720 px la nav devient une rangée d'onglets. Mouvement : fondu d'entrée du voile (existant), fondu court sur changement d'onglet. `prefers-reduced-motion` respecté.

## Fichiers

- Nouveau : `components/settings/settings-panel.tsx`, `components/settings/settings.css`.
- `components/onboarding/step-auth.tsx` : exporte `KeyField`, `OpenRouterKey`, `BytnodeKey`, `Subscriptions` (liste nue) pour réemploi.
- `components/chat/chat-shell.tsx` : l'état `Editing` devient `{ tab, agent? }` ; `Wizard` n'y est plus importé.
