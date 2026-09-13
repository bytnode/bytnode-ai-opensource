# Gestion automatique du contexte, validation des arguments, TodoWrite

Date : 2026-09-13. Décisions prises avec l'utilisateur en une salve :
compaction automatique **en fin de tour à 90 %**, élagage des anciens
résultats d'outils **comme Claude Code / Codex** (les N plus récents intacts,
les autres remplacés par un marqueur quand le contexte est lourd), et après
une erreur « contexte dépassé » : **compaction puis rejeu automatique**.

## 1. Gestion automatique du contexte

### Détection du débordement — `lib/agent/compact.ts`
`isContextOverflow(error)` : `LlmError` 400/413 dont le message parle de
longueur de contexte (`context length`, `too long`, `too many tokens`,
`maximum … tokens`, `exceed … context`, `prompt is too long`). Pur, testé.

### Élagage — `lib/agent/history.ts`
`pruneToolOutputs(messages, { keep, head })` sur la suite `ProviderMessage[]`
rejouée : les `keep` derniers messages `tool` restent entiers ; les plus
anciens dont le contenu dépasse `head` caractères deviennent
`<head premiers caractères>\n[… sortie élaguée pour libérer du contexte (N
caractères). Relance l'outil si tu as besoin du détail.]`. Le fil affiché
n'est jamais modifié — seul ce que le modèle reçoit change. Pur, testé.

Décision d'appliquer : dans `use-chat.ts`, `usageState(dernier usage,
fenêtre du modèle, estimation)` ; `level ∈ {warn, full}` → `keep = 6, head =
400`. Après un débordement : `keep = 0, head = 200` (« dur »).

### Compaction automatique — `use-chat.ts`
`send` devient une enveloppe autour d'un `turn(conversationId, texte, opts)`
qui ne dépend plus de l'état React `streamingId` pour s'enchaîner. En fin
de tour propre (pas d'erreur, pas d'arrêt, pas déjà une compaction) : si
`usageState(...).level === "full"` → `turn(id, "/compact", { compactedBy:
"auto" })`. Le message de compaction porte `compactedBy` (`user` | `auto` |
`overflow`) et `message.tsx` l'affiche : « Conversation compactée »,
« … automatiquement (fenêtre pleine) », « … (contexte dépassé) ».

### Récupération — `use-chat.ts`
Sur `isContextOverflow(e)` :
1. Si la réponse ratée est vide (aucun pas) : l'échange est retiré du fil,
   compaction « dure », puis rejeu du message tel quel (pièces jointes et
   recherche conservées).
2. Si elle a déjà travaillé (des pas) : elle reste, compaction « dure » (le
   résumé couvre l'« En cours »), puis un tour « Continue : reprends la tâche
   où elle s'est arrêtée. »
3. Si la compaction elle-même échoue : erreur claire sur le message,
   « Tapez /compact pour résumer le fil, ou ouvrez une nouvelle conversation. »
Une seule récupération par tour : pas de boucle.

Portée : moteur OpenRouter. Les agents ACP gèrent leur propre contexte.

## 2. Validation des arguments — `lib/tools/validate.ts`
`validateArgs(schema, args): string | null` — mini-validateur JSON-Schema
sans dépendance couvrant ce que nos outils déclarent : `type` (string,
integer, number, boolean, array, object), `required`, `enum`, `items.type`,
`minimum`/`maximum`, `pattern`, `additionalProperties: false`. Message en
français : « `path` requis (string) », « `limit` : entier attendu, reçu
"abc" », « `action` : valeur hors liste (add, search, list) ». Pur, testé.

Branché dans `runAgentLoop` (`lib/agent/loop.ts`) **avant** la permission :
un appel invalide devient `{ ok: false, output: "Arguments invalides pour
Read : … Corrige l'appel." }` sans exécuter ni demander. Couvre l'agent
principal (navigateur) et les sous-agents Workflow (serveur).

## 3. `TodoWrite` — `lib/tools/todo.ts`
Paramètres : `todos: Array<{ content: string; status: "pending" |
"in_progress" | "completed" }>` — la liste complète à chaque appel. L'outil
émet `{ type: "plan", entries }` via `ctx.emit` (le même événement que les
plans ACP → bloc plan existant de `message.tsx`, jamais rejoué par
`history.ts`) et rend la liste en texte au modèle. Non gaté. Ajouté à
`baseTools`, résumé dans `names.ts` (« 3/5 faites »), mentionné dans
`tools-prompt.ts` : à utiliser dès qu'une tâche a plus de deux étapes.

## Ordre de construction (TDD, un test rouge avant chaque fichier)
1. `validate.ts` + test → branchement dans `loop.ts` + test.
2. `todo.ts` + test → registre, noms, prompt.
3. `isContextOverflow` + test ; `compactionMessage(compactedBy)` ; libellés.
4. `pruneToolOutputs` + test.
5. `use-chat.ts` : `turn`, fenêtre, élagage, auto-compaction, récupération ;
   `chat-shell.tsx` passe `window` ; `message.tsx` libellés.
6. `typecheck`, `lint`, `test` ; CLAUDE.md.
