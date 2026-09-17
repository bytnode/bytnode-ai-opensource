# Publication sur npm — `npx bytnode-ai`

**Date** : 2026-09-17 · **Statut** : validé en discussion, à implémenter

## But

N'importe qui, sur Windows, macOS ou Linux, lance `npx bytnode-ai` et obtient BytNode-AI dans son
navigateur, avec l'assistant de premier lancement qui lui demande *ses* clés. Rien de la machine
de l'auteur (clés, comptes exchange, dossiers de travail) ne part sur npm ; une vérification
mécanique le garantit à chaque publication.

## Décisions prises

| Question | Décision |
|---|---|
| Expérience cible | `npx bytnode-ai` : une commande, le serveur local démarre, le navigateur s'ouvre |
| Agents par abonnement | Les six toujours listés ; détectés s'ils sont déjà sur la machine ; « Installer » pose ceux qui manquent ; puis « Se connecter » |
| Plateformes | Windows, macOS et Linux dès la première version |
| Licence | MIT, titulaire « BytNode » |
| Comment le paquet démarre | **Build livré** : `next build` au moment du `npm publish`, `next start` chez l'utilisateur (voir « Approches écartées ») |
| Données utilisateur | `~/.bytnode-ai/` (surchargeable par `BYTNODE_AI_HOME`) |

## État des lieux (ce qui rend la chose possible)

- **Aucun secret dans le code.** Grep de `cb_live_`, `cb_test_`, `sk-or-v1-` sur l'arbre :
  seul `.env.local` (git-ignoré, lu par des scripts ad hoc) en contient. Les clés OpenRouter et
  BytNode, les comptes exchange et les agents vivent dans le `localStorage` du navigateur ; les
  fichiers de travail dans `workspaces/` et `sandboxes/` (git-ignorés) ; les agents téléchargés
  dans `~/.bytnode-ai/agents/`.
- **Le multi-plateforme est déjà écrit** : `pick-folder` (PowerShell / osascript / zenity),
  `openTerminal` (cmd / osascript / x-terminal-emulator), capture d'écran côté navigateur. Il
  reste à le prouver, pas à l'écrire.
- **Ce qui bloque** : `process.cwd()` sert de racine projet (`lib/server/workspace.ts`,
  `lib/acp/launch.ts`, `lib/acp/sessions.ts`, `lib/mcp/finance-server.ts`) ; le serveur MCP est
  lancé par `tsx` sur la source TypeScript ; les cinq paquets d'agents pèsent ~1 Go de
  dépendances ; `@qwen-code/qwen-code` (118 Mo) ne sert qu'à `.probe-acp.mjs` ; pas de `LICENSE`.

## Section 1 — Le paquet et le `bin`

### `package.json`

```jsonc
{
  "name": "bytnode-ai",                       // libre sur npm (« agent-chat » est pris)
  "version": "0.1.0",
  "license": "MIT",
  "repository": "github:benjfrem07/bytnode-ai",
  "bin": { "bytnode-ai": "bin/bytnode-ai.mjs" },
  "engines": { "node": ">=20.9" },            // exigence de Next 16
  "files": ["bin", ".next", "lib", "professions", "types", "tsconfig.json", "next.config.ts", "proxy.ts"],
  "scripts": { "prepack": "tsx scripts/prepack.ts", "...": "inchangés" }
}
```

- `files` est une **liste blanche** : `.env.local`, `workspaces/`, `sandboxes/`, `app/`,
  `components/`, `docs/`, `scratchpad/`, `.probe-acp.mjs`, `CLAUDE.md`, `AGENTS.md` ne partent
  pas. `README.md` et `LICENSE` partent toujours (règle npm).
  - `lib/` + `tsconfig.json` + `types/` : `sessions.ts` lance le serveur MCP avec `tsx` sur
    `lib/mcp/finance-server.ts`, dont les imports `@/lib/…` se résolvent par le tsconfig.
  - `professions/` : prompts et skills lus à l'exécution.
  - `next.config.ts`, `proxy.ts` : lus par `next start`.
  - `.next/` : la sortie de `next build`, sans `cache/` (supprimé par `prepack`).
- **Dépendances** : retirer `@qwen-code/qwen-code` ; sortir de `dependencies` les cinq paquets
  d'agents (`@zed-industries/claude-agent-acp`, `@agentclientprotocol/codex-acp`,
  `@google/gemini-cli`, `@github/copilot`, `@xai-official/grok`) et l'`overrides` du SDK Claude :
  tout cela passe dans la table de la section 3. `tsx` reste en `dependencies` (exécution).
  `typescript`, `eslint`, `vitest`, `@types/*` restent en devDependencies : `npx` ne les installe
  jamais.

### `scripts/prepack.ts`

Exécuté automatiquement par `npm publish` et `npm pack` :

1. `rm -rf .next` puis `next build` (build propre, jamais un build de dev).
2. `rm -rf .next/cache`.
3. Contrôle de l'archive : `npm pack --dry-run --json`, puis `lib/publish/pack-check.ts` (pure,
   testée) refuse si un chemin correspond à `.env*`, `workspaces/`, `sandboxes/`, `.mcp.json`,
   `scratchpad/`, ou si un fichier texte de l'archive contient `cb_live_`, `cb_test_` ou
   `sk-or-v1-`. En cas de refus : liste des chemins fautifs, code de sortie 1, rien n'est publié.

### `bin/bytnode-ai.mjs`

Node pur, sans dépendance, ~60 lignes :

1. Dossier du paquet = `path.resolve(fileURLToPath(import.meta.url), "..", "..")`. Vérifie
   `process.versions.node` ≥ 20.9, sinon message clair et sortie 1.
2. Options : `--port N` (défaut 3777), `--no-open`, `--version`, `--help`. Si le port est occupé
   (`EADDRINUSE` au test de liaison) : le dit et propose `--port`.
3. `spawn(process.execPath, [<paquet>/node_modules/next/dist/bin/next, "start", "--port", N],
   { cwd: <paquet>, stdio: "inherit" })`. Le `cwd` est le dossier du paquet : **`PROJECT_ROOT =
   process.cwd()` reste vrai** et aucun des quatre fichiers cités ne change pour la racine.
4. Attend que `http://localhost:N/` réponde (sonde toutes les 250 ms, 60 s max), puis ouvre le
   navigateur (`cmd /c start ""` / `open` / `xdg-open`) sauf `--no-open`, et affiche l'URL et la
   version. Ctrl-C (SIGINT/SIGTERM) tue le serveur.

Mise à jour : `npx bytnode-ai@latest`.

## Section 2 — Les données utilisateur : `~/.bytnode-ai/`

Installé par `npx`, « le projet » est `~/.npm/_npx/<hash>/node_modules/bytnode-ai/` : purgé sans
prévenir, remplacé à chaque version. Rien de l'utilisateur ne doit y vivre.

| Aujourd'hui (dans le projet) | Demain | Code |
|---|---|---|
| `workspaces/<id>` | `~/.bytnode-ai/workspaces/<id>` | `lib/server/workspace.ts` |
| `workspaces/_acp` | `~/.bytnode-ai/workspaces/_acp` | `lib/acp/prepare.ts` |
| `skills/` (skills de l'utilisateur) | `~/.bytnode-ai/skills/` | `lib/tools/skills/skill.ts` (`projectSkills`) |
| `~/.bytnode-ai/agents/<id>` | inchangé | `lib/acp/launch.ts` |

- `lib/server/data-dir.ts` (pure, testée) : `dataDir()` = `BYTNODE_AI_HOME` s'il est défini,
  sinon `path.join(os.homedir(), ".bytnode-ai")`. Tout le reste en dérive ; `PROJECT_ROOT` ne
  sert plus qu'au code et aux ressources du paquet (`professions/`, `lib/`, `node_modules/`).
- **Un seul emplacement partout**, en `npm run dev` comme installé : pas de cas particulier.
- **Reprise de l'existant** : `resolveWorkspace` garde sa logique — si `<projet>/workspaces/<id>`
  ou `<projet>/sandboxes/<id>` existe encore, il est déplacé (`rename`, avec copie + suppression si
  le déplacement traverse un volume) vers le nouvel emplacement, une fois. Un dossier de travail
  choisi explicitement (`requested`) n'est pas concerné. `localStorage` ne bouge pas.
- `finance-server.ts` reçoit déjà `BYTNODE_AI_WORKSPACE` ; il reçoit aussi `BYTNODE_AI_HOME` pour
  résoudre les skills utilisateur sans dépendre du cwd.
- Le prompt outils (`tools-prompt.ts`), `README.md` et `skills/README.md` disent le nouvel
  emplacement.

## Section 3 — Les six agents : détectés, installés à la demande

### La table `lib/acp/packages.ts` (pure, testée)

Remplace ce que `launch.ts` code en dur et le champ `distribution` d'`agents.ts` :

```ts
type AgentSource =
  | { kind: "npm"; pkg: string; version: string; overrides?: Record<string, string>;
      acp: { entry: string[]; args: string[] };   // relatif à node_modules/<pkg>
      cli?: { entry: string[] };                   // pour l'état de connexion / login
      global?: { command: string; args: string[] } } // CLI sur le PATH parlant ACP
  | { kind: "download"; registryId: string; exe: Record<string, string>; fallback: Record<string, string> };
```

| Agent | Source | Lancement ACP | Global sur le PATH |
|---|---|---|---|
| claude | `@zed-industries/claude-agent-acp` ^0.23.1, override `@anthropic-ai/claude-agent-sdk` ^0.3.270 | `dist/index.js` | — (l'adaptateur embarque le produit) |
| openai | `@agentclientprotocol/codex-acp` ^1.11.0 | `dist/index.js` | — (idem) |
| gemini | `@google/gemini-cli` ^0.59.0 | `bundle/gemini.js --acp` | `gemini --acp` |
| copilot | `@github/copilot` ^1.0.83 | `npm-loader.js --acp` | `copilot --acp` |
| grok | `@xai-official/grok` ^1.0.25 | `bin/grok agent stdio` | `grok agent stdio` |
| mistral | registre ACP `mistral-vibe` (inchangé) | `vibe-acp` | — |

Les entrées `cli` reprennent `CLI_LAUNCH` actuel (Codex : `@openai/codex/bin/codex.js` dans le
`node_modules` de l'adaptateur ; Claude : `claudeCli()` inchangé, résolu depuis le dossier
d'installation de l'adaptateur).

### Résolution (`acpLaunch`, `cliLaunch`, `isInstalled` dans `launch.ts`)

1. `~/.bytnode-ai/agents/<id>/node_modules/<pkg>/<entry>` — posé par « Installer ».
2. Pour les agents qui ont `global` : un exécutable de ce nom sur le PATH (`lib/acp/detect.ts`,
   `findOnPath(name, { env, platform })` : parcours de `PATH`, `PATHEXT` sous Windows ; injectable,
   testé).
3. Sinon absent.

Plus de résolution dans le `node_modules` du projet : un seul chemin en dev et chez l'utilisateur.
`.probe-acp.mjs` lit le même dossier `~/.bytnode-ai/agents/`.

### Installation d'un paquet npm (`install.ts`)

À côté du chemin « download » existant :

1. Écrit `~/.bytnode-ai/agents/<id>/package.json` =
   `{ "private": true, "dependencies": { [pkg]: version }, "overrides": overrides ?? {} }`.
2. Lance `npm install --no-audit --no-fund --loglevel=error` dans ce dossier, avec le
   `npm-cli.js` livré avec le Node en cours (`<dirname(process.execPath)>/node_modules/npm/bin/
   npm-cli.js` sous Windows, `<prefix>/lib/node_modules/npm/bin/npm-cli.js` ailleurs), exécuté par
   `process.execPath` ; secours : `npm` sur le PATH. Délai 15 min. Sortie conservée pour le message
   d'échec (300 derniers caractères, comme `extract`).
3. États inchangés : `installing` (promesse partagée), échec dans `message`. « Désinstaller »
   supprime le dossier (existe déjà).

**Mise à jour** : `authStatus` lit la version installée (`node_modules/<pkg>/package.json`) ; si
elle ne satisfait plus la plage de la table (`semver.satisfies` — implémentation locale minimale
pour `^x.y.z`, pure, testée, pas de dépendance), l'état porte `outdated: true` et le bouton devient
« Mettre à jour » (même action `install`). C'est ainsi qu'une montée de version de BytNode-AI
apporte un nouveau modèle sans intervention.

### État et UI

`AcpAuthStatus` gagne `source: "installed" | "global" | null` et `outdated?: boolean` ; `available`
garde son sens (lançable). `Subscriptions` (`step-auth.tsx`, partagé avec le panneau de réglages) :

- les six toujours listés ;
- absent → « Installer » (tout agent, plus seulement Mistral) ; pendant : « Installation » ;
- disponible → « Se connecter » / état du compte comme aujourd'hui ; sous-titre « installé par
  BytNode-AI » ou « détecté : gemini » ;
- `outdated` → « Mettre à jour » ;
- « Désinstaller » seulement pour `source: "installed"`, jamais pour un CLI global.

## Section 4 — Vérification et publication

### Tests unitaires (Vitest, `lib/`)

- `lib/server/data-dir.test.ts` : surcharge par `BYTNODE_AI_HOME`, défaut `~/.bytnode-ai`.
- `lib/acp/packages.test.ts` et `detect.test.ts` : résolution dans l'ordre avec fs et PATH injectés
  (Windows avec `PATHEXT`, Unix), `outdated` selon la plage.
- `lib/acp/install.test.ts` : contenu du `package.json` généré (dépendance, override).
- `lib/publish/pack-check.test.ts` : chemins interdits, motifs de clés, cas propre.

### Bout en bout (`scripts/smoke-pack.mjs`, lancé à la main)

`npm pack` → dossier temporaire → `npm init -y && npm i <tgz>` → `npx bytnode-ai --port 3790
--no-open` → `GET /` 200, `GET /api/tools` renvoie les professions, le serveur MCP démarre depuis
le paquet (`tools/list` via le client MCP du scratchpad avec `BYTNODE_AI_PROJECT_ROOT` = dossier du
paquet, `BYTNODE_AI_HOME` = dossier temporaire), `POST /api/acp/auth {agent: gemini, action:
install}` pose `agents/gemini/node_modules/@google/gemini-cli`. Ce test lève le seul risque de
l'approche retenue : des chemins absolus de la machine de build dans `.next/`.

### Trois OS

`.github/workflows/pack.yml`, matrice `ubuntu-latest` / `macos-latest` / `windows-latest` :
`npm ci`, `npm test`, `npm pack`, installation du `.tgz` dans un dossier temporaire, démarrage,
`GET /api/tools`. C'est la preuve du multi-plateforme ; elle tourne à chaque push.

### Documentation et licence

- `LICENSE` : MIT, « Copyright (c) 2026 BytNode ».
- `README.md` : section « Installer » en tête — `npx bytnode-ai` ; prérequis : Node ≥ 20.9,
  Python + pandas optionnels (Backtest), `zenity` sous Linux (sélecteur de dossier) ; où vivent les
  données (`~/.bytnode-ai/`) ; comment mettre à jour ; les agents par abonnement s'installent depuis
  l'interface.
- `CLAUDE.md` : commandes `npm pack` / smoke, `~/.bytnode-ai/`, la table des agents, le rôle de
  `prepack`.

### Publication (par l'auteur)

1. Commiter le déplacement du projet dans `bytnode-agent-ai/` comme un renommage (préalable à tout).
2. `npm login` (compte npm de l'auteur, 2FA).
3. `npm publish` : `prepack` build, nettoie, contrôle, refuse si un secret passe.
4. Depuis un dossier vide : `npx bytnode-ai@0.1.0` — le test final.
5. Ensuite, à chaque livraison : `npm version patch|minor` puis `npm publish`.

## Approches écartées

- **Build chez l'utilisateur au premier lancement** : minutes de build et 1-2 Go de RAM à chaque
  purge du cache `npx` ; `typescript` et `@types/*` deviennent des dépendances ; un build qui
  échoue chez l'utilisateur (Defender sur `.next/`, `sudo` pour `npm i -g` sous Linux/macOS) ne se
  répare pas à distance ; non reproductible.
- **`output: "standalone"`** : le traçage des natifs se fait au build, donc sur Windows
  (`@resvg/resvg-js-win32-x64-msvc`, `ripgrep.exe`) — cassé hors Windows par construction ;
  `npm pack` exclut les `node_modules` imbriqués ; `.next/static` et `public/` à copier à la main ;
  le serveur MCP lancé par `tsx` échappe au traçage. À reconsidérer seulement pour une image Docker.

## Hors périmètre

- Publication automatique par GitHub Actions sur tag (`NPM_TOKEN`) : plus tard, si le rythme le
  justifie.
- Utiliser un Claude Code ou un Codex déjà installé globalement à la place de l'adaptateur : les
  adaptateurs embarquent leur propre produit ; l'économie (234 Mo / 378 Mo) ne vaut pas la
  divergence de versions.
- Application de bureau (Electron/Tauri).
