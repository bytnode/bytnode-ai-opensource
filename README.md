# BytNode-AI

Des agents IA financiers, en local : chacun a un métier (Standard, Analyste, Stratégique,
Quantitatif), des outils (fichiers, shells, web, sous-agents) et une source de données de marché,
BytNode, interrogée par MCP. Les modèles viennent d'OpenRouter (par clé) ou de votre **abonnement**
— Claude, OpenAI, Gemini, GitHub Copilot, Grok, Mistral — dans ce cas c'est
l'agent de l'éditeur (Claude Code, Codex, Gemini CLI, Copilot CLI, Grok Build, Mistral Vibe) qui tourne, habillé par BytNode-AI, via le protocole ACP.

**Next.js 16 (App Router) · React 19 · TypeScript strict · CSS écrit à la main · Vitest.**
Le fond est celui de BytNode (`components/fond`), avec les mêmes tokens (`--ink`, `--paper`,
`--voile`) et les mêmes polices (Geist, Inter, IBM Plex Mono).

## Lancer

```bash
npm install
npm run dev        # http://localhost:3777 (le port 3000 est laissé libre)
```

Au premier lancement, l'assistant de configuration s'ouvre au-dessus du fond : profil (dont
quelques mots sur vous, transmis à tous les agents), **Authentification** (onglet Abonnement :
six éditeurs, bouton Se connecter — ou Installer pour ceux qui se téléchargent ; onglet Clés :
OpenRouter ; la clé BytNode dans les deux cas), puis un premier agent (nom, fournisseur, profession, contexte texte + fichiers, dossier
de travail choisi dans l'explorateur, périmètre, mode des outils). La colonne de gauche liste ensuite vos **agents** ;
celui qu'on ouvre montre ses conversations. « Nouvel agent » ne redemande ni le profil ni la
clé. Le crayon modifie un agent, la corbeille le supprime avec ses conversations, l'engrenage
en bas rouvre le compte (profil + clé). Tout est mémorisé dans `localStorage`
(`agentchat:settings`, `agentchat:conversations`) ; rien ne quitte l'ordinateur sauf ce qui
part vers OpenRouter.

```bash
npm test           # Vitest sur lib/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
```

`OPENROUTER_BASE_URL` (serveur) redirige les appels vers un autre hôte — un relais, ou un faux
OpenRouter pour tester le flux sans clé.

### Chez quel fournisseur part la requête

Un même modèle est servi par plusieurs fournisseurs, et leurs latences n'ont rien à voir : par
défaut OpenRouter répartit la charge, et le même tour peut répondre en 3 s ou en 34 s selon qui le
reçoit (mesuré). Toutes nos requêtes portent donc `provider: { sort: "latency", ignore: ["parasail"] }`
(`lib/server/provider-routing.ts`). Réglable par variables d'environnement :

| Variable | Défaut | Effet |
|---|---|---|
| `OPENROUTER_PROVIDER_SORT` | `latency` | `latency`, `throughput` ou `price` |
| `OPENROUTER_IGNORE_PROVIDERS` | `parasail` | liste à écarter ; vide = personne |
| `OPENROUTER_PROVIDER_ORDER` | — | ordre explicite ; prime sur le tri |
| `OPENROUTER_ALLOW_FALLBACKS` | `1` | `0` interdit tout autre fournisseur (risque d'échec) |

### Par abonnement (ACP)

Cinq agents sont des dépendances npm (Claude Code, Codex, Gemini CLI, Copilot CLI, Grok Build) :
rien d'autre à installer. Mistral Vibe est un binaire par plateforme :
`Installer` lit l'entrée du registre ACP (github.com/agentclientprotocol/registry), télécharge
l'archive de la machine et l'extrait dans `~/.bytnode-ai/agents/<id>/` (`lib/acp/install.ts`).
`Se connecter` ouvre le navigateur sur la page de l'éditeur (Claude et Copilot : dans une fenêtre de
terminal ; OpenAI : `codex login` ; les autres : la méthode `authenticate` que l'agent annonce —
compte personnel, jamais une clé API), et l'état se relit tout seul. Pour les agents sans CLI
d'état, « connecté » = une session d'essai acceptée (`lib/acp/auth.ts`, cache 90 s).

Un agent dont le fournisseur est `acp:claude` / `acp:openai` / `acp:gemini` ne fait pas tourner
notre boucle : le serveur (`lib/acp/`) lance l'agent externe en sous-processus (JSON-RPC sur stdio),
**une session par conversation** (`session/new`, rechargée par `session/load` après un redémarrage,
tuée après 15 min de silence), lui passe **BytNode comme serveur MCP HTTP**, dépose les compétences
de la profession dans `.agents/skills/` et `.claude/skills/` du dossier de travail, et lui donne le
prompt BytNode-AI (Claude : en complément du prompt système ; Codex / Gemini : en tête du premier
message). Ses outils sont les siens ; ses demandes de permission prennent nos boutons Autoriser /
Toujours / Refuser (mode Demande) ou sont acceptées (mode Direct). Les modèles et l'effort viennent
des options de session de l'agent (`lib/acp/models.ts`, cache 1 h).

Les clés `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` sont retirées de l'environnement des sous-processus :
c'est l'abonnement qui doit être facturé, pas l'API. Pour Claude, un `.claude/settings.local.json`
est posé dans le dossier de travail (`permissions.defaultMode: default`) et les réglages personnels
de l'utilisateur ne sont pas chargés.

## Architecture

```
app/
  layout.tsx, page.tsx            shell : assistant en overlay si non configuré, sinon le chat
  api/chat/route.ts               POST → relaie une completion en flux (SSE) depuis OpenRouter, outils compris
  api/tools/route.ts              GET → dossier de travail résolu, spécifications des outils, compétences
  api/tools/execute/route.ts      POST → exécute un outil, flux NDJSON (lignes, sous-agents, résultat)
  api/openrouter/models/route.ts  GET → catalogue (cache 1 h, pas de clé requise)
  api/openrouter/key/route.ts     GET → vérifie une clé
  api/bytnode/key/route.ts        GET → vérifie une clé BytNode (connexion MCP)
  api/acp/auth|models|prompt|permission|cancel   les agents par abonnement (voir ci-dessus)
  api/system/pick-folder/route.ts POST → le sélecteur de dossier natif
components/
  fond/        FondMarine (porté de BytNode)
  onboarding/  Wizard, StepProfil, StepAuth (Abonnement | Clés), StepAgent, ProviderPicker, ContextFiles, FolderField
  chat/        ChatShell, Sidebar, Thread, Message, Composer, ModelPicker, useChat
  ui/          Field, SearchPanel (liste + recherche, partagé), ThemeToggle, icônes
lib/
  domain/      types (Profile, ApiKeys, AgentConfig[], Conversation{agentId}, Message{steps}, Model, Provider)
  llm/         interface LlmClient { streamChat() } + OpenRouterClient + lecteur SSE (texte, tool_calls)
  agent/       loop.ts (la boucle modèle → outils → modèle, isomorphe), history.ts (pas → messages),
               tool-calls.ts (recollage des fragments), events.ts, prompt.ts, tools-prompt.ts
  acp/         agents.ts (catalogue, partagé), launch.ts, install.ts, connection.ts, sessions.ts, translate.ts,
               auth.ts, models.ts, prompt.ts, skills-sync.ts, prepare.ts, client.ts + use-auth.ts (navigateur)
  tools/       ← LE DOSSIER DES OUTILS : types.ts (interface Tool), registry.ts, names.ts (outils gardés)
    fs/        Read (texte, images, PDF, .ipynb), Write, Edit (chaîne unique), NotebookEdit, Glob, Grep (ripgrep embarqué)
    exec/      run.ts (spawn borné), shells.ts (Bash via Git bash, PowerShell), monitor.ts (commande ou WebSocket, borné)
    web/       search.ts (greffon web d'OpenRouter, 45 s × 2), fetch.ts (turndown + GFM, garde SSRF)
    agents/    workflow.ts (sous-agents en parallèle, côté serveur)
    skills/    skill.ts (skills/<nom>/SKILL.md : dossier de travail, projet, ~/.agents/skills)
    client.ts  ce que le navigateur en voit (specs + exécution par la route)
  catalog/     modèles OpenRouter → fournisseurs, « derniers sortis », recherche
  storage/     interface Storage + BrowserStorage/MemoryStorage ; repositories
  agent/       buildSystemPrompt(profil, agent)
  state/       magasins (useSyncExternalStore) : settings, conversations, catalogue
  server/      ce que les routes savent d'OpenRouter
```

### Les professions

`professions/<id>/PROMPT.md` est le prompt système du métier, `professions/<id>/skills/<nom>/SKILL.md`
ses compétences propres, `professions/_commun/skills/` celles que tous partagent (`source-bytnode` :
comment interroger la source ; `reponse-financiere` : la forme d'une réponse). Tout est du fichier,
modifiable à la main. Le prompt final d'un agent = profil utilisateur + prompt de profession +
contexte de l'agent + section Environnement (outils, périmètre, état de BytNode, compétences).

| Profession | Prompt | Compétences propres |
|---|---|---|
| Standard | généraliste finance/crypto, premier interlocuteur | lecture-marche |
| Analyste | données → tendances et scénarios, macro intégrée | analyse-tendance, contexte-macro, rapport-analyse |
| Stratégique | stratégies complètes et testables, axées crypto | conception-strategie, gestion-risque, plan-backtest |
| Quantitatif | maths, stats, Python, backtests honnêtes | python-quant, validation-statistique, backtest-python |

### BytNode (source de données)

Serveur MCP distant (`https://api.bytnode.com/mcp`, surchargeable par `BYTNODE_MCP_URL`), en-tête
`X-API-KEY`, clé saisie dans la page Clés (bouton Vérifier). Ses outils (`get_system_info`,
`get_market_data`, `get_history`, `get_market_indicators`, `get_market_emotions`…) sont découverts à la
connexion (`lib/mcp/bytnode.ts`) et donnés à tous les agents en plus des outils de base, jamais soumis
à permission (lecture seule). Sans clé, les agents le savent et le disent.

### Les outils

Tous les agents ont le même jeu de base : Read, Write, Edit, NotebookEdit, Glob, Grep, Bash,
PowerShell, Monitor, WebSearch, WebFetch, Workflow, Skill — plus quatre outils financiers
(`lib/tools/finance/`) :

- **SaveMarketData** : un outil BytNode → un CSV dans le dossier de travail, sans faire transiter
  les lignes par le modèle (le tableau est trouvé dans la réponse JSON, quelle que soit sa forme).
- **Chart** : un graphique PNG (bougies ou ligne, volume, colonnes superposées, marqueurs, niveaux)
  depuis un CSV, rendu en SVG puis rasterisé (`@resvg/resvg-js`) ; l'image est jointe au résultat
  (le modèle la voit) et affichée dans le fil (servie par `/api/files`, jamais hors du dossier).
- **Backtest** : le moteur standard `py/backtest.py` (Python + pandas) — l'agent n'écrit que
  `signal(df)` / `stop_distance(df)` ; exécution à la bougie suivante, frais, slippage, funding,
  taille par le risque, in/out-of-sample, métriques par période et par année, acheter-et-garder,
  courbe de capital. Soumis à permission (il exécute le Python de l'agent).
- **Memory** : des notes datées dans `.bytnode-ai/memory.jsonl` du dossier de travail ; les 25
  dernières sont glissées dans le prompt de chaque tour (`/api/memory`).
- **TodoWrite** : la liste de tâches de l'agent sur une demande longue, envoyée en entier à chaque
  appel et affichée dans le fil (le même bloc « plan » que les agents par abonnement).

Le contexte se gère tout seul (moteur OpenRouter) : au-delà de 70 % de la fenêtre du modèle, les
anciens résultats d'outils sont élagués dans ce que le modèle reçoit (le fil affiché garde tout) ;
à 90 % en fin de tour, le fil est compacté automatiquement ; si le fournisseur refuse le contexte,
le fil est compacté puis votre message rejoué. Les arguments de chaque appel d'outil sont vérifiés
contre son schéma avant toute exécution : un appel mal formé revient au modèle avec la raison.

Les agents par abonnement reçoivent les mêmes quatre outils par un serveur MCP stdio local
(`lib/mcp/finance-server.ts`, lancé avec `tsx`), passé dans `session/new` à côté de BytNode. Chaque outil est un fichier de
`lib/tools/` qui implémente `Tool { name, description, parameters, execute(args, ctx) }` ;
`registry.ts` les assemble. Ajouter un outil = un fichier + une ligne dans le registre.

La boucle (`lib/agent/loop.ts`) tourne **dans le navigateur** pour l'agent principal (modèle via
`/api/chat`, outils via `/api/tools/execute`, permissions demandées à l'écran) et **sur le
serveur** pour les sous-agents de Workflow (tout en direct). Un message d'assistant mémorise ses
*pas* (texte, appels, résultats) et `history.ts` les rejoue au format du fournisseur.

- **Dossier de travail et périmètre** : chaque agent a un dossier (`workspaces/<id>` par défaut,
  ou choisi dans l'explorateur) où les shells démarrent et où les chemins relatifs se résolvent.
  Périmètre `Dossier de travail seulement` (les outils fichiers refusent tout chemin extérieur ;
  une commande shell qui en désigne un est refusée avant de partir) ou `Tout le disque`.
- **Permissions** : par agent, `Demande avant d'agir` (Bash, PowerShell, Monitor, Write, Edit,
  NotebookEdit, Workflow attendent un accord dans le fil ; « Toujours pour cet agent » bascule
  en direct) ou `Exécution directe`. Basculable dans l'en-tête du chat.
- **WebSearch** : le greffon `web` d'OpenRouter, sur la clé OpenRouter (modèle de recherche :
  `OPENROUTER_SEARCH_MODEL`, par défaut `deepseek/deepseek-v4.1-flash`) ; 45 s, deux tentatives.
- **Compétences** : `skills/<nom>/SKILL.md` (en-tête YAML `name`, `description`). Celles que vous
  écrivez vont dans `skills/` à la racine (voir `skills/README.md`) : les agents sur OpenRouter les
  lisent là, les agents par abonnement en reçoivent une copie dans `.agents/skills/` et
  `.claude/skills/` de leur dossier de travail (`lib/acp/skills-sync.ts` : idempotent, ne touche pas
  à ce que vous avez écrit à la main, retire ce que le projet ne fournit plus). Sont aussi lus le
  dossier de travail de l'agent et `~/.agents/skills`. Tous sont listés dans le prompt et chargés
  par l'outil Skill.

### Trader sur un exchange

Dans **Authentification**, la section « Comptes exchange » accepte autant de comptes que vous voulez parmi Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate.io, HTX et MEXC : un nom (celui que l'agent emploiera, « Binance-main »), la clé API, le secret, une passphrase pour ceux qui en demandent, et « réseau de test » quand l'exchange en a un. « Tester » ouvre la connexion et lit le solde. Les clés restent dans votre navigateur, comme les autres, et voyagent avec chaque requête d'outil. Créez-les côté exchange avec les droits que vous voulez accorder — l'application n'a de toute façon aucun outil de retrait.

Chaque agent choisit ensuite, dans sa configuration, **quels comptes il peut piloter**. Sans compte rattaché, il n'a aucun outil exchange. Avec, il dispose de :

- **lecture, sans permission** : `ExchangeBalance` (soldes, estimation USD), `ExchangePositions` (positions futures, PnL, liquidation), `ExchangeOrders` (ordres ouverts ou historique avec frais), `ExchangeTicker` (prix, carnet, funding sur *cet* exchange), `ExchangeWatch` (un relevé toutes les N secondes pendant 10 minutes au plus, arrêt sur `price>=…`, `pnl<…`, `liq<3%` ou `closed`) ;
- **action, avec permission** : `PlaceOrder` (market, limit, stop, stop-limit, take-profit ; quantité en actif ou en devise de cotation ; `reduceOnly`, levier), `CancelOrder`, `ClosePosition` (tout ou une fraction), `Transfer` (spot ↔ futures d'un même compte), `SetLeverage`.

Un ordre, une fermeture de position ou un transfert **vous est toujours demandé** — même quand l'agent est en « Exécution directe », et sans bouton « Toujours ». Le badge **RÉEL** (rouge) ou **TESTNET** dans l'en-tête de la conversation et sur chaque demande dit sur quel argent porte l'action. Les futures sont gérés en one-way (une position par paire) ; un compte en hedge mode est refusé avec un message. Les agents par abonnement (Claude Code, Codex…) reçoivent les mêmes outils par le serveur MCP `bytnode-ai`.

Deux compétences communes guident les agents : `trading-execution` (solde → prix → taille → ordre → confirmation) et `trade-review` (revue de positions et d'historique, seuils d'alerte).

Chaque exchange a ses limites, relevées sur sa documentation et sur ccxt ; l'application les connaît et refuse avant tout appel, avec la raison — l'agent les lit aussi dans son prompt :

| Exchange | Futures | Transfert spot ↔ futures | Testnet | À savoir |
| --- | --- | --- | --- | --- |
| Binance | oui | oui | oui | Les clés du testnet spot (testnet.binance.vision) et du testnet futures (testnet.binancefuture.com) sont distinctes. |
| Bybit | oui | non — compte unifié, un seul solde | oui | Clés testnet créées sur testnet.bybit.com. |
| OKX | oui | non — compte de trading unifié | oui (démo) | Passphrase ; clés démo créées en mode démo. |
| Coinbase | non | non | non | Advanced Trade ; le secret est la clé privée EC de la clé CDP (collée telle quelle, avec ou sans `\n`). |
| Kraken | non | non | non | Kraken Futures a ses propres clés, hors de cette intégration. |
| Bitget | oui | oui | non | Passphrase ; le compte doit être en one-way (vérifié avant chaque ordre). |
| KuCoin | oui | oui | non | Passphrase ; une même clé (permissions Spot + Futures) sert les deux marchés. |
| Gate.io | oui | oui | oui | Pas de mode de marge par l'API (levier seulement). |
| HTX | oui | non | non | Pas de mode de marge par l'API. |
| MEXC | lecture seule | oui | non | MEXC a fermé le passage d'ordres futures par API (25/07/2022). |

Sur Bybit, OKX, KuCoin (et le portefeuille Funding de Binance), un dépôt n'arrive pas sur le compte de trading mais dans un portefeuille séparé : « Tester » et `ExchangeBalance` lisent les deux et disent où sont les fonds ; `Transfer` avec `from: funding` les rapatrie vers le trading (compte unifié sur Bybit).

L'horloge du PC est compensée : ccxt mesure l'écart avec chaque exchange à l'ouverture (et toutes les dix minutes) et date les requêtes à *son* heure — Binance et Bybit refusent une requête datée plus d'une seconde après la leur. Un refus de ce type est nommé comme tel (« horloge décalée d'environ N s »).

### Le « + » du bloc de saisie

Trois actions, et ce qu'elles font vraiment :

- **Ajouter des fichiers** — les fichiers choisis sont **déposés dans `entrees/` du dossier de
  travail** de l'agent (`/api/files/upload`), et le message envoyé au modèle porte leurs chemins :
  l'agent les lit avec ses outils. Rien n'est collé dans le prompt, donc un CSV de milliers de
  lignes reste exploitable (`Read`, pandas, `Chart`, `Backtest`). Les **images** sont en plus
  montrées au modèle : réduites côté navigateur (JPEG, 1 600 px de grand côté) pour ne pas gonfler
  le fil, qui vit dans `localStorage`.
- **Prendre une capture d'écran** — par l'API de partage d'écran du **navigateur**
  (`lib/agent/capture.ts`) : c'est vous qui choisissez l'écran ou la fenêtre, une seule image est
  prise, le flux est refermé aussitôt. Elle est réduite, déposée dans `entrees/` et montrée au
  modèle. *Pourquoi pas côté serveur : capturer l'écran en PowerShell (`CopyFromScreen`) est le
  motif exact des voleurs de données — l'antivirus de Windows bloque le script
  (« ScriptContainedMaliciousContent »).*
- **Recherche approfondie** — arme la consigne pour le message suivant : l'agent suit la compétence
  `recherche-approfondie` (découper, chercher plusieurs fois autrement, remonter aux sources,
  recouper deux sources indépendantes, garder les désaccords, tout dater).

Ce qui est joint s'affiche en pastilles au-dessus du champ (retirables) puis au-dessus du message
dans le fil.

### La jauge, le filet et les permissions

En bas à droite du fil : **contexte occupé / fenêtre du modèle**, **jetons par seconde** pendant la
réponse, et **coût du tour**. L'infobulle détaille entrée, sortie, prix et fournisseur. La jauge
passe à l'ambre à 70 % de la fenêtre, au rouge à 90 % — c'est le signal pour `/compact`. Les
données viennent du décompte qu'OpenRouter met dans le dernier morceau du flux (`usage: { include: true }`)
et des `usage_update` des agents par abonnement (`lib/agent/usage.ts`, pur et testé).

La boucle a un filet (`lib/agent/resilience.ts`) : une erreur transitoire (429, 502, connexion
coupée) est **relancée** jusqu'à trois fois avec attente croissante, tant que rien n'a encore été
affiché ; et le même appel d'outil avec les mêmes arguments trois fois de suite n'est pas exécuté une
quatrième — l'agent reçoit un refus qui lui dit de changer de voie.

Les agents publient aussi leur **plan** et leur **raisonnement** : le plan s'affiche en liste cochée,
la réflexion dans un bloc replié. Ni l'un ni l'autre n'est rejoué au modèle (`history.ts`).

**« Toujours » ne bascule plus l'agent en exécution directe.** Il mémorise une règle : l'outil
(`Write`) ou le début de la commande (`Bash(git status *)`) — le bouton dit ce qu'il accorde, et la
règle est gardée dans l'agent (`allowRules`). Une commande irréversible (effacement récursif,
formatage, `git push --force`, tuyau vers un interpréteur…) n'a pas de bouton « Toujours » et
redemande à chaque fois (`lib/tools/permissions.ts`).

### Compacter une conversation

`/compact` dans le champ de saisie (ou le bouton **Compacter** de l'en-tête, qui apparaît quand le
fil est assez fourni) demande à l'agent un résumé structuré — demande, fait, décisions, en cours, à
ne pas refaire — puis **remplace le fil par ce résumé** (`lib/agent/compact.ts`, pur et testé).
`/compact garde les niveaux de prix` ajoute une consigne au résumé.

Le même geste sert aux deux moteurs : un agent sur OpenRouter retrouve le résumé en tête de son
historique (rejoué comme contexte, pas comme une de ses réponses) ; un agent par abonnement voit sa
session fermée, et la suivante repart du résumé au lieu de l'historique complet.

### Les données

`Settings` v2 porte `agents: AgentConfig[]` et `activeAgentId` ; chaque `Conversation` porte
son `agentId`. Les données v1 (un seul `agent`, conversations sans `agentId`) sont migrées à la
lecture sous l'id fixe `agent-1` (`LEGACY_AGENT_ID`), sans réécriture tant qu'on n'enregistre rien.

### Le catalogue

OpenRouter ne publie pas de liste d'éditeurs : le fournisseur est dérivé du préfixe de l'id
(`anthropic/claude-sonnet-5`). Deux formes d'id ne sont pas des modèles nouveaux et sont
exclues des « derniers sortis » tout en restant cherchables : les déclinaisons
(`openai/gpt-5:free`, `:batch`, `:thinking`…) et les alias mobiles (`~anthropic/claude-opus-latest`).
