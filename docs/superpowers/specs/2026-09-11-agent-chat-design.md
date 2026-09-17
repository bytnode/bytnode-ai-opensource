# Agent de dialogue — design v1 (2026-09-11)

## But
Application locale de dialogue avec un agent configuré par l'utilisateur, branchée sur
OpenRouter. Pas d'outils en v1 : c'est un chatbot classique, mais l'architecture doit
accueillir plus tard un domaine de prédiction d'outils.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript strict · CSS écrit à la main (mêmes tokens
que bytnode : `--ink`, `--paper`, `--voile`, Geist / Inter / IBM Plex Mono, thème sombre et
clair) · Vitest pour `lib/`. Le fond est `FondMarine`, porté depuis bytnode tel quel.

## Architecture
```
app/
  layout.tsx, page.tsx            shell : wizard en overlay si non configuré, sinon le chat
  api/chat/route.ts               POST → stream SSE depuis OpenRouter (clé passée en header)
  api/openrouter/models/route.ts  GET → catalogue modèles (cache serveur 1 h)
  api/openrouter/key/route.ts     GET → vérifie une clé
components/
  fond/        FondMarine
  onboarding/  Wizard, StepProfil, StepCles, StepAgent, ProviderPicker
  chat/        ChatShell, Sidebar, MessageList, Message, Composer, ModelPicker
  ui/          Button, Field, SearchPanel (liste + recherche, partagé par les deux pickers)
lib/
  domain/      types : Profile, ApiKeys, AgentConfig, Conversation, Message, Model, Provider
  llm/         interface LlmClient { streamChat() } + OpenRouterClient  ← point d'extension
  catalog/     modèles OpenRouter → fournisseurs (préfixe de l'id), tri par date, recherche
  storage/     interface Storage + adaptateur localStorage ; repositories
  agent/       buildSystemPrompt(profil, agent)
  state/       contextes React (settings, conversations)
```

## Onboarding (overlay au-dessus du fond, 3 étapes, Retour / Suivant)
1. Profil : prénom, nom, email (optionnel).
2. Clés API : clé OpenRouter (masquée) + « Vérifier ».
3. Agent : nom · fournisseur (panneau avec recherche en haut + liste des éditeurs
   OpenRouter) · contexte (texte + fichiers texte lus côté client, ~200 Ko/fichier max,
   pas de PDF).
« Terminer » ouvre le chat. Réouvrable depuis les réglages.

## Chat
Sidebar (nouvelle conversation, historique, réglages), fil de messages (markdown), composer
(Entrée envoie, Maj+Entrée saut de ligne, Stop pendant le stream). Sélecteur de modèle dans
le bloc de conversation : les 3 derniers modèles sortis du fournisseur (tri `created`) +
recherche sur tous les modèles du fournisseur. Modèle mémorisé par conversation.

Prompt système = nom de l'agent + contexte texte + fichiers + profil utilisateur.

## Erreurs
Clé absente/invalide → bandeau vers les réglages. Erreur OpenRouter → message dans le fil +
« Réessayer ». Catalogue indisponible → état vide + « Recharger ».

## Persistance
localStorage (`agentchat:settings`, `agentchat:conversations`) derrière une interface.
Un seul agent en v1.

## Vérification
Vitest sur `lib/`, `tsc --noEmit`, `next build`, contrôle visuel avec `npm run dev`.
