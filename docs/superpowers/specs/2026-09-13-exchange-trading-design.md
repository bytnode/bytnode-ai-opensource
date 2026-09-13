# Trading sur exchanges centralisés — design

Date : 2026-09-13. Statut : validé en brainstorming, à planifier.

## But

Donner aux agents la capacité d'**agir** sur des comptes d'exchanges centralisés :
passer et annuler des ordres (spot et futures), fermer des positions, déplacer
des fonds entre spot et futures, régler le levier — et de **lire** soldes,
positions, ordres, prix. Le tout par des outils, avec la permission par action
déjà en place (`ask` / « Toujours »), pour les agents OpenRouter comme pour
les agents par abonnement (ACP).

## Décisions

| Question | Décision |
|---|---|
| Où sont les fonds | Exchanges centralisés seulement (pas de wallet on-chain en v1) |
| Bibliothèque | `ccxt`, multi-exchange, spot **et** futures |
| Contrôle | Permission par action (`GATED_TOOLS`, `permissions.ts`), **sans** plafonds chiffrés |
| Retraits externes | **Aucun outil** ; interdit par construction |
| Clés | Même modèle qu'OpenRouter/BytNode : `localStorage`, en-tête par requête, rien sur disque serveur |
| Agents ACP | Inclus via le serveur MCP `finance-server.ts` |
| Analyse des trades | Pas d'outil dédié : outils de lecture + CSV/Chart/Memory existants + skills |

## Architecture

### Comptes et clés

- `Settings.keys.exchanges: ExchangeAccount[]` :
  `{ id, exchange (id ccxt), label, apiKey, secret, password?, testnet: boolean }`.
  Migration settings **v2 → v3** (défaut `[]`) dans `lib/storage/repositories.ts`.
- `AgentConfig.exchangeAccountIds?: string[]` : les comptes que cet agent peut
  piloter. Vide/absent = aucun outil exchange dans son prompt.
- Page Authentification : section « Exchanges » (liste, ajout, suppression,
  « Tester » → `POST /api/exchange/check` → `fetchBalance` → `{ ok, message }`).
- Configuration agent : multi-sélection des comptes.
- Transport : en-tête `x-exchange-accounts` (JSON des comptes **autorisés pour
  l'agent**) sur `GET /api/tools` et `POST /api/tools/execute` — le client
  `lib/tools/client.ts` l'ajoute comme `x-bytnode-key`. Le serveur ne le
  journalise jamais.

### Modules serveur (`lib/tools/exchange/`)

- `accounts.ts` (pur, testé) : `parseAccountsHeader(raw): ExchangeAccount[]`
  (JSON invalide → `[]`), `pickAccount(accounts, name?)` — un seul compte →
  implicite ; plusieurs sans `account` → erreur qui liste les labels ; label ou
  id inconnu → erreur.
- `client.ts` : `clientFor(account, market: "spot" | "futures")` → instance
  `new ccxt[exchange]({ apiKey, secret, password, enableRateLimit: true, options: { defaultType: market === "futures" ? "swap" : "spot" } })`,
  `setSandboxMode(true)` si `testnet`, `loadMarkets()` mémorisé, cache `Map` par
  `sha256(exchange + apiKey + market)`. Remplaçable (injection) pour les tests.
  `ccxt` ajouté à `serverExternalPackages`.
- `symbols.ts` (pur, testé) : `BTC/USDT` + `futures` → `BTC/USDT:USDT`
  (perp linéaire) ; laisse passer un symbole déjà complet.
- `format.ts` (pur, testé) : soldes, positions, ordres, ticker → texte compact
  en français ; montants arrondis à la précision du marché.
- `errors.ts` (pur, testé) : `ccxt.InsufficientFunds` / `InvalidOrder` /
  `AuthenticationError` / `RateLimitExceeded` / `NetworkError` → phrase courte
  + texte de l'exchange. `RateLimitExceeded` et `NetworkError` : l'outil
  réessaie **une** fois après 1 s.
- Un fichier par outil, `Tool { name, description, parameters, execute }`.

### Les outils

Tous : `account?` (label ou id), `market?: "spot" | "futures"` (défaut `spot`).
`amount` toujours en actif de **base**, arrondi via `amountToPrecision`, refusé
sous le minimum du marché (message explicite).

| Outil | Permission | Arguments | Retour |
|---|---|---|---|
| `ExchangeBalance` | non | `account?`, `market?` | par actif : libre, bloqué, ≈ USD ; total |
| `ExchangePositions` | non | `account?`, `symbol?` | côté, taille, entrée, mark, PnL latent (montant, %), levier, liquidation |
| `ExchangeOrders` | non | `account?`, `symbol?`, `status: "open" \| "closed"`, `since?`, `limit?` | id, type, côté, prix, qté, rempli, statut, frais |
| `ExchangeTicker` | non | `account?`, `symbol`, `market?`, `depth?` | last, bid/ask, volume 24 h, funding + prochain funding, carnet N niveaux |
| `PlaceOrder` | **oui** | `symbol`, `side`, `type: market \| limit \| stop \| stop_limit \| take_profit`, `amount`, `price?`, `stopPrice?`, `reduceOnly?`, `leverage?`, `postOnly?`, `timeInForce?` | id, statut, prix moyen, rempli |
| `CancelOrder` | **oui** | `orderId?` **ou** `symbol` + `all: true` | ce qui a été annulé |
| `ClosePosition` | **oui** | `symbol`, `fraction?` (0–1, défaut 1) | ordre market `reduceOnly` opposé, résultat |
| `Transfer` | **oui** | `asset`, `amount`, `from: spot \| futures`, `to` | id du transfert (interne uniquement) |
| `SetLeverage` | **oui** | `symbol`, `leverage`, `marginMode?: isolated \| cross` | confirmé |

- Les cinq outils d'écriture entrent dans `GATED_TOOLS` (`names.ts`). Les
  règles « Toujours » utilisent `matchesRule` tel quel :
  `PlaceOrder(BTC/USDT *)`, `CancelOrder`…
- `names.ts` : libellé lisible avant le clic, par exemple
  « PlaceOrder — Binance-main · LONG 0.05 BTC/USDT:USDT market ×5 ».
- Les outils ne sont ajoutés par `allTools({…, exchangeAccounts})` **que si**
  la liste est non vide ; `tools-prompt.ts` ajoute une ligne
  « Comptes exchange : Binance-main (spot+futures), Bybit-test (testnet) ».
- `ToolContext.exchangeAccounts?: ExchangeAccount[]`.

### Agents ACP

`lib/mcp/finance-server.ts` reçoit `BYTNODE_AI_EXCHANGE_ACCOUNTS` (JSON) dans
l'environnement du sous-processus (`lib/acp/sessions.ts`, à côté de la clé
BytNode) et expose les neuf outils avec la même implémentation. La permission
passe par le mécanisme ACP existant (`/api/acp/permission`) ; les cinq outils
d'écriture demandent **toujours**, quel que soit le mode de l'agent externe.
`/api/acp/prompt` reçoit les comptes de l'agent dans son corps de requête (pas
en en-tête, pour rester cohérent avec le reste de cette route).

### Skills

- `professions/_commun/skills/trading-execution/SKILL.md` : la méthode —
  vérifier le solde → ticker → calculer la taille en base → ordre → confirmer
  par `ExchangeOrders` ; ne jamais enchaîner deux ordres sans lire le premier.
- `professions/_commun/skills/trade-review/SKILL.md` : analyser des positions
  ouvertes (PnL, distance à la liquidation, funding, exposition par actif) et
  un historique de fills (`ExchangeOrders closed` → CSV → `Chart`).

## Erreurs et cas limites

- Aucun compte autorisé : les outils n'existent pas pour l'agent.
- Compte ambigu / inconnu : erreur listant les labels.
- Marché inconnu, montant sous le minimum, précision : refusé avec le détail.
- Fonds insuffisants, levier hors bornes, ordre rejeté : texte de l'exchange
  transmis tel quel après une phrase en français.
- Rate limit / réseau : un second essai, puis l'erreur.
- Clé invalide : `AuthenticationError` → invite à « Tester » dans
  Authentification.
- `Transfer` ne connaît que `spot` et `futures` ; pas d'adresse externe.

## Tests

- Purs : `accounts`, `symbols`, `format`, `errors`, libellés `names`, règles
  `permissions` (`PlaceOrder(BTC/USDT *)`), migration settings v3.
- Outils : faux client injecté à la place de `clientFor` — chaque outil a au
  moins un test « chemin heureux » et un test d'erreur exchange.
- Jamais d'appel réel en test. Vérification de bout en bout : script
  scratchpad contre un **testnet** (Binance / Bybit), non commité.

## Ordre de construction

1. Types + migration settings v3 + `accounts.ts`, `symbols.ts`, `format.ts`, `errors.ts` (TDD).
2. `client.ts` + les quatre outils de lecture + registre conditionnel + en-tête + `ToolContext`.
3. Les cinq outils d'écriture + `GATED_TOOLS` + libellés + prompt.
4. UI : section Exchanges (Authentification), `/api/exchange/check`, sélection des comptes par agent.
5. ACP : env + `finance-server.ts` + `sessions.ts` + permission « toujours ».
6. Skills, `CLAUDE.md`, `README.md`.

## Hors périmètre (v1)

Wallets on-chain, retraits externes, plafonds chiffrés par agent, paper
trading simulé, widget de rendu dédié, outil `TradeReport`.
