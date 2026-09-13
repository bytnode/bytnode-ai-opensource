# Trading sur exchanges centralisés — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux agents dix outils exchange (`ccxt`, spot + futures) — lecture, ordres, positions, transferts, levier, surveillance — avec permission par action, `PlaceOrder`/`ClosePosition`/`Transfer` demandant toujours, pour les agents OpenRouter et ACP.

**Architecture:** Les comptes (`ExchangeAccount[]`) vivent dans `Settings.keys.exchanges` (localStorage, v3) et voyagent par l'en-tête `x-exchange-accounts` vers `/api/tools` et `/api/tools/execute` (ou dans le corps de `/api/acp/prompt`, puis l'env `BYTNODE_AI_EXCHANGE_ACCOUNTS` du serveur MCP). Chaque agent choisit ses comptes (`AgentConfig.exchangeAccountIds`) ; sans compte, les outils n'existent pas pour lui. Dans `lib/tools/exchange/`, des modules purs testés (`accounts`, `symbols`, `errors`, `format`, `watch-until`, `catalog`) entourent un adaptateur `client.ts` (une instance ccxt par compte × marché, mockée par `vi.mock` dans les tests d'outils) et un fichier par outil.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, Vitest (node), `ccxt` v4 (serveur seulement, `serverExternalPackages`).

**Spec:** `docs/superpowers/specs/2026-09-13-exchange-trading-design.md`

**Conventions à respecter (voir `CLAUDE.md`)** : prose et messages en français ; `typecheck`, `lint`, `test` propres avant chaque commit ; pas de `next dev` lancé par vous (port 3777 = l'utilisateur) ; écrire les fichiers avec l'outil Write (les heredocs Bash abîment les antislashs) ; jamais d'appel réel à un exchange dans un test.

---

## Carte des fichiers

**Créés**
- `lib/tools/exchange/catalog.ts` — les dix exchanges (id ccxt, libellé, testnet dispo). Pur, partagé navigateur/serveur.
- `lib/tools/exchange/accounts.ts` (+ `.test.ts`) — parse/valide les comptes, choisit un compte, filtre les comptes d'un agent.
- `lib/tools/exchange/symbols.ts` (+ `.test.ts`) — normalise `BTC/USDT` ↔ `BTC/USDT:USDT`.
- `lib/tools/exchange/errors.ts` (+ `.test.ts`) — erreurs ccxt → français ; `withRetry`.
- `lib/tools/exchange/format.ts` (+ `.test.ts`) — soldes / positions / ordres / ticker → texte.
- `lib/tools/exchange/watch-until.ts` (+ `.test.ts`) — grammaire `pnl<-50`, `price>=70000`, `liq<3%`, `closed`.
- `lib/tools/exchange/client.ts` — `clientFor(account, market)` : instance ccxt cachée.
- `lib/tools/exchange/common.ts` — ce que tous les outils partagent : résoudre compte + client + symbole.
- `lib/tools/exchange/balance.ts`, `positions.ts`, `orders.ts`, `ticker.ts`, `watch.ts`, `place-order.ts`, `cancel-order.ts`, `close-position.ts`, `transfer.ts`, `set-leverage.ts` (+ un `.test.ts` chacun) — les dix outils.
- `lib/tools/exchange/index.ts` — `exchangeTools()`.
- `app/api/exchange/check/route.ts` — « Tester » un compte.
- `components/onboarding/exchange-accounts.tsx` — la section Exchanges de l'authentification.
- `professions/_commun/skills/trading-execution/SKILL.md`, `professions/_commun/skills/trade-review/SKILL.md`.

**Modifiés**
- `lib/domain/types.ts` — `ExchangeAccount`, `ApiKeys.exchanges`, `AgentConfig.exchangeAccountIds`, `Settings.version: 3`.
- `lib/storage/repositories.ts` (+ test) — migration v3.
- `lib/tools/types.ts` — `ToolContext.exchangeAccounts`.
- `lib/tools/registry.ts` — outils exchange si comptes.
- `lib/tools/names.ts` (+ nouveau `names.test.ts`) — `GATED_TOOLS`, `ALWAYS_ASK`, `alwaysAsks`, libellés.
- `lib/tools/permissions.ts` (+ test) — `matchesRule`/`ruleFor` refusent `ALWAYS_ASK`.
- `lib/tools/client.ts`, `app/api/tools/route.ts`, `app/api/tools/execute/route.ts`, `lib/tools/agents/workflow.ts` — transport des comptes.
- `lib/agent/tools-prompt.ts` — section « Comptes exchange ».
- `components/chat/use-chat.ts`, `components/chat/tool-step.tsx`, `components/chat/chat-shell.tsx` — comptes de l'agent, permission toujours, badge RÉEL/TESTNET.
- `components/onboarding/step-auth.tsx`, `step-agent.tsx`, `wizard.tsx` — UI.
- `lib/acp/sessions.ts`, `lib/acp/client.ts`, `app/api/acp/prompt/route.ts`, `lib/mcp/finance-server.ts` — ACP.
- `next.config.ts`, `package.json` — `ccxt`.
- `CLAUDE.md`, `README.md`.

---

### Task 1 : dépendance `ccxt`, types, migration settings v3

**Files:**
- Modify: `package.json`, `next.config.ts:11`
- Modify: `lib/domain/types.ts:18-23`, `:34-69`, `:79-91`
- Modify: `lib/storage/repositories.ts:15-27`, `:57-78`, `:100-118`
- Test: `lib/storage/repositories.test.ts`

- [ ] **Step 1 : installer ccxt et le déclarer externe**

Run: `npm install ccxt@^4`
Puis dans `next.config.ts`, ajouter `"ccxt"` à la liste :

```ts
serverExternalPackages: ["@vscode/ripgrep", "pdf-parse", "turndown", "@joplin/turndown-plugin-gfm", "fast-glob", "@agentclientprotocol/sdk", "@resvg/resvg-js", "ccxt"],
```

- [ ] **Step 2 : écrire le test de migration qui échoue**

Ajouter dans `lib/storage/repositories.test.ts`, dans `describe("SettingsRepository")` :

```ts
  test("v3 : les comptes exchange et les comptes par agent, avec des defauts pour la v2", () => {
    const storage = new MemoryStorage();
    storage.set(
      "agentchat:settings",
      JSON.stringify({
        version: 2,
        onboardingDone: true,
        keys: { openrouter: "k", bytnode: "" },
        agents: [{ id: "a1", name: "A", providerId: "openai" }],
        activeAgentId: "a1",
      }),
    );
    const s = new SettingsRepository(storage).load();
    expect(s.version).toBe(3);
    expect(s.keys.exchanges).toEqual([]);
    expect(s.agents[0].exchangeAccountIds).toEqual([]);
  });

  test("v3 : garde les comptes exchange valides et ignore les entrees informes", () => {
    const storage = new MemoryStorage();
    storage.set(
      "agentchat:settings",
      JSON.stringify({
        version: 3,
        keys: {
          openrouter: "k",
          bytnode: "",
          exchanges: [
            { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", testnet: false },
            { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "p", testnet: true },
            { label: "sans id" },
            "n'importe quoi",
          ],
        },
        agents: [{ id: "a1", name: "A", providerId: "openai", exchangeAccountIds: ["x1", 42, "x9"] }],
        activeAgentId: "a1",
      }),
    );
    const s = new SettingsRepository(storage).load();
    expect(s.keys.exchanges).toEqual([
      { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false },
      { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "p", testnet: true },
    ]);
    expect(s.agents[0].exchangeAccountIds).toEqual(["x1", "x9"]);
  });
```

- [ ] **Step 3 : vérifier l'échec**

Run: `npx vitest run lib/storage/repositories.test.ts`
Expected: FAIL — `expected 2 to be 3` et `exchanges` undefined.

- [ ] **Step 4 : les types**

Dans `lib/domain/types.ts`, remplacer le bloc `ApiKeys` :

```ts
/** Un compte sur un exchange centralise, pilote par ccxt. Les cles restent
    dans le navigateur et voyagent par en-tete a chaque requete d'outil —
    jamais sur le disque du serveur. */
export type ExchangeAccount = {
  id: string;
  /** L'id ccxt : `binance`, `bybit`, `okx`… (voir `lib/tools/exchange/catalog.ts`). */
  exchange: string;
  /** Le nom que l'agent emploie pour designer ce compte : « Binance-main ». */
  label: string;
  apiKey: string;
  secret: string;
  /** La passphrase, pour les exchanges qui en demandent (OKX, KuCoin, Bitget). */
  password: string;
  /** Vrai : le compte est sur le reseau de test de l'exchange. */
  testnet: boolean;
};

/** Une cle par service : OpenRouter pour dialoguer (et chercher sur le
    web), BytNode pour les donnees de marche, et les comptes d'exchanges
    sur lesquels les agents peuvent agir. */
export type ApiKeys = {
  openrouter: string;
  bytnode: string;
  exchanges: ExchangeAccount[];
};
```

Dans `AgentConfig`, après `allowRules?: string[];` :

```ts
  /** Les comptes d'exchange (ids de `ApiKeys.exchanges`) que cet agent peut
      piloter. Vide : aucun outil exchange dans son prompt. */
  exchangeAccountIds?: string[];
```

Dans `Settings` : `version: 3;`.

- [ ] **Step 5 : la migration**

Dans `lib/storage/repositories.ts` :

`defaultSettings()` : `version: 3,` et `keys: { openrouter: "", bytnode: "", exchanges: [] },`.

`blankAgent()` : ajouter `exchangeAccountIds: [],` après `allowRules: [],`.

Dans `normalizeAgent`, après la ligne `allowRules:` :

```ts
    exchangeAccountIds: Array.isArray(raw.exchangeAccountIds) ? raw.exchangeAccountIds.filter((r): r is string => typeof r === "string") : [],
```

Ajouter, au-dessus de `normalizeSettings`, la normalisation d'un compte :

```ts
/** Un compte exchange lisible : id, exchange, label et cle presents. Les
    autres entrees sont ecartees sans bruit. */
function normalizeExchangeAccount(raw: unknown): ExchangeAccount | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const exchange = str(raw.exchange);
  if (!id || !exchange) return null;
  return {
    id,
    exchange,
    label: str(raw.label, exchange),
    apiKey: str(raw.apiKey),
    secret: str(raw.secret),
    password: str(raw.password),
    testnet: raw.testnet === true,
  };
}
```

Importer `ExchangeAccount` depuis `@/lib/domain/types` dans la ligne d'import existante. Dans `normalizeSettings`, le retour :

```ts
    version: 3,
    …
    keys: {
      openrouter: str(keys.openrouter),
      bytnode: str(keys.bytnode),
      exchanges: Array.isArray(keys.exchanges) ? keys.exchanges.map(normalizeExchangeAccount).filter((a): a is ExchangeAccount => a !== null) : [],
    },
```

- [ ] **Step 6 : vérifier**

Run: `npx vitest run lib/storage/repositories.test.ts && npm run typecheck`
Expected: PASS ; le typecheck signalera les endroits qui construisent `ApiKeys` sans `exchanges` (au moins `components/chat/use-chat.ts` ou des tests : ajouter `exchanges: []`). Corriger jusqu'à propre.

- [ ] **Step 7 : commit**

```bash
git add package.json package-lock.json next.config.ts lib/domain/types.ts lib/storage/repositories.ts lib/storage/repositories.test.ts
git commit -m "exchange : types des comptes, settings v3, dependance ccxt"
```

---

### Task 2 : catalogue des exchanges et module `accounts`

**Files:**
- Create: `lib/tools/exchange/catalog.ts`
- Create: `lib/tools/exchange/accounts.ts`
- Test: `lib/tools/exchange/accounts.test.ts`

- [ ] **Step 1 : le catalogue (données, pas de test)**

```ts
/* Les exchanges proposes a l'utilisateur : les dix plus gros, par leur id
   ccxt. `testnet` : ccxt sait basculer ce compte sur le reseau de test
   (`setSandboxMode`). `password` : l'exchange exige une passphrase. Pur,
   partage navigateur / serveur. */
export type ExchangeInfo = { id: string; label: string; testnet: boolean; password: boolean };

export const EXCHANGES: ExchangeInfo[] = [
  { id: "binance", label: "Binance", testnet: true, password: false },
  { id: "bybit", label: "Bybit", testnet: true, password: false },
  { id: "okx", label: "OKX", testnet: true, password: true },
  { id: "coinbase", label: "Coinbase", testnet: false, password: false },
  { id: "kraken", label: "Kraken", testnet: false, password: false },
  { id: "bitget", label: "Bitget", testnet: false, password: true },
  { id: "kucoin", label: "KuCoin", testnet: false, password: true },
  { id: "gate", label: "Gate.io", testnet: true, password: false },
  { id: "htx", label: "HTX", testnet: false, password: false },
  { id: "mexc", label: "MEXC", testnet: false, password: false },
];

export const exchangeInfo = (id: string): ExchangeInfo | undefined => EXCHANGES.find((e) => e.id === id);
```

- [ ] **Step 2 : le test qui échoue**

`lib/tools/exchange/accounts.test.ts` :

```ts
import { describe, expect, test } from "vitest";
import { allowedAccounts, describeAccounts, parseAccounts, parseAccountsHeader, pickAccount } from "./accounts";
import type { ExchangeAccount } from "@/lib/domain/types";

const main: ExchangeAccount = { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false };
const test1: ExchangeAccount = { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "", testnet: true };

describe("parseAccounts", () => {
  test("garde les comptes complets, ecarte le reste", () => {
    expect(parseAccounts([main, { id: "x", label: "sans exchange" }, null, "x"])).toEqual([main]);
    expect(parseAccounts("pas une liste")).toEqual([]);
  });
  test("depuis un en-tete : JSON illisible ou vide → aucun compte", () => {
    expect(parseAccountsHeader(JSON.stringify([main, test1]))).toEqual([main, test1]);
    expect(parseAccountsHeader("{oops")).toEqual([]);
    expect(parseAccountsHeader(null)).toEqual([]);
    expect(parseAccountsHeader("")).toEqual([]);
  });
});

describe("pickAccount", () => {
  test("un seul compte : implicite", () => {
    expect(pickAccount([main], undefined)).toEqual({ account: main });
  });
  test("plusieurs comptes sans nom : erreur qui liste les labels", () => {
    const r = pickAccount([main, test1], undefined);
    expect("error" in r && r.error).toBe("Plusieurs comptes : précise `account` parmi Binance-main, Bybit-test.");
  });
  test("par label (insensible a la casse) ou par id", () => {
    expect(pickAccount([main, test1], "bybit-test")).toEqual({ account: test1 });
    expect(pickAccount([main, test1], "x1")).toEqual({ account: main });
  });
  test("inconnu : erreur", () => {
    const r = pickAccount([main, test1], "Kraken");
    expect("error" in r && r.error).toBe("Compte inconnu : « Kraken ». Comptes disponibles : Binance-main, Bybit-test.");
  });
  test("aucun compte : erreur", () => {
    expect(pickAccount([], undefined)).toEqual({ error: "Aucun compte exchange n'est rattaché à cet agent." });
  });
});

describe("allowedAccounts", () => {
  test("ne rend que les comptes de la liste de l'agent, dans l'ordre des reglages", () => {
    expect(allowedAccounts([main, test1], ["x2"])).toEqual([test1]);
    expect(allowedAccounts([main, test1], ["x9", "x1"])).toEqual([main]);
    expect(allowedAccounts([main, test1], undefined)).toEqual([]);
  });
});

describe("describeAccounts", () => {
  test("une ligne pour le prompt", () => {
    expect(describeAccounts([main, test1])).toBe("Binance-main (binance, RÉEL), Bybit-test (bybit, testnet)");
  });
});
```

- [ ] **Step 3 : vérifier l'échec**

Run: `npx vitest run lib/tools/exchange/accounts.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 4 : implémentation**

`lib/tools/exchange/accounts.ts` :

```ts
import type { ExchangeAccount } from "@/lib/domain/types";

/* ---------------------------------------------------------------------------
   Les comptes d'exchange, vus des outils.

   Ils arrivent du navigateur (en-tete `x-exchange-accounts`, ou corps de
   la requete ACP, ou env du serveur MCP), deja filtres : ce sont ceux que
   L'AGENT a le droit de piloter. Ici on les lit sans confiance, on en
   choisit un par son label, et on les decrit pour le prompt. Pur.
--------------------------------------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Ne garde que les comptes complets : id, exchange, label, cle. */
export function parseAccounts(value: unknown): ExchangeAccount[] {
  if (!Array.isArray(value)) return [];
  const out: ExchangeAccount[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const exchange = str(raw.exchange);
    const label = str(raw.label);
    if (!id || !exchange || !label) continue;
    out.push({ id, exchange, label, apiKey: str(raw.apiKey), secret: str(raw.secret), password: str(raw.password), testnet: raw.testnet === true });
  }
  return out;
}

/** L'en-tete tel qu'il arrive : JSON, ou rien. */
export function parseAccountsHeader(raw: string | null | undefined): ExchangeAccount[] {
  if (!raw) return [];
  try {
    return parseAccounts(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Les comptes qu'un agent peut piloter, dans l'ordre des reglages. */
export const allowedAccounts = (all: ExchangeAccount[], ids: string[] | undefined): ExchangeAccount[] =>
  ids?.length ? all.filter((a) => ids.includes(a.id)) : [];

const labels = (accounts: ExchangeAccount[]) => accounts.map((a) => a.label).join(", ");

/** Le compte vise par un appel : implicite s'il n'y en a qu'un, sinon par
    label (sans la casse) ou par id. */
export function pickAccount(accounts: ExchangeAccount[], name: string | undefined): { account: ExchangeAccount } | { error: string } {
  if (accounts.length === 0) return { error: "Aucun compte exchange n'est rattaché à cet agent." };
  if (!name?.trim()) {
    if (accounts.length === 1) return { account: accounts[0] };
    return { error: `Plusieurs comptes : précise \`account\` parmi ${labels(accounts)}.` };
  }
  const wanted = name.trim().toLowerCase();
  const found = accounts.find((a) => a.label.toLowerCase() === wanted || a.id === name.trim());
  return found ? { account: found } : { error: `Compte inconnu : « ${name.trim()} ». Comptes disponibles : ${labels(accounts)}.` };
}

/** Pour le prompt : « Binance-main (binance, RÉEL), Bybit-test (bybit, testnet) ». */
export const describeAccounts = (accounts: ExchangeAccount[]): string =>
  accounts.map((a) => `${a.label} (${a.exchange}, ${a.testnet ? "testnet" : "RÉEL"})`).join(", ");
```

- [ ] **Step 5 : vérifier**

Run: `npx vitest run lib/tools/exchange/accounts.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6 : commit**

```bash
git add lib/tools/exchange/catalog.ts lib/tools/exchange/accounts.ts lib/tools/exchange/accounts.test.ts
git commit -m "exchange : catalogue des exchanges et lecture des comptes"
```

---

### Task 3 : `symbols.ts`

**Files:**
- Create: `lib/tools/exchange/symbols.ts`
- Test: `lib/tools/exchange/symbols.test.ts`

- [ ] **Step 1 : test**

```ts
import { describe, expect, test } from "vitest";
import { toSymbol } from "./symbols";

describe("toSymbol", () => {
  test("spot : la paire, en majuscules", () => {
    expect(toSymbol("btc/usdt", "spot")).toBe("BTC/USDT");
  });
  test("futures : complete en perp lineaire", () => {
    expect(toSymbol("BTC/USDT", "futures")).toBe("BTC/USDT:USDT");
    expect(toSymbol("ETH/USDC", "futures")).toBe("ETH/USDC:USDC");
  });
  test("un symbole deja complet passe tel quel", () => {
    expect(toSymbol("BTC/USDT:USDT", "futures")).toBe("BTC/USDT:USDT");
    expect(toSymbol("BTC/USD:BTC", "futures")).toBe("BTC/USD:BTC");
  });
  test("une paire collee retrouve sa barre sur les quotes connues", () => {
    expect(toSymbol("BTCUSDT", "spot")).toBe("BTC/USDT");
    expect(toSymbol("solusdc", "futures")).toBe("SOL/USDC:USDC");
    expect(toSymbol("ETHBTC", "spot")).toBe("ETH/BTC");
  });
  test("une paire spot demandee avec un suffixe perp perd le suffixe", () => {
    expect(toSymbol("BTC/USDT:USDT", "spot")).toBe("BTC/USDT");
  });
});
```

- [ ] **Step 2 : échec**

Run: `npx vitest run lib/tools/exchange/symbols.test.ts` — FAIL, module introuvable.

- [ ] **Step 3 : implémentation**

```ts
/* Les symboles au format ccxt : `BTC/USDT` en spot, `BTC/USDT:USDT` pour un
   perpetuel lineaire. Le modele ecrit souvent `BTCUSDT` ou en minuscules ;
   on repare ce qui se repare. Pur. */

export type Market = "spot" | "futures";

const QUOTES = ["USDT", "USDC", "FDUSD", "BUSD", "USD", "EUR", "BTC", "ETH", "BNB"];

export function toSymbol(raw: string, market: Market): string {
  let s = raw.trim().toUpperCase();
  if (!s.includes("/")) {
    const quote = QUOTES.find((q) => s.endsWith(q) && s.length > q.length);
    if (quote) s = `${s.slice(0, -quote.length)}/${quote}`;
  }
  const [pair, settle] = s.split(":");
  if (market === "spot") return pair;
  if (settle) return s;
  const quote = pair.split("/")[1];
  return quote ? `${pair}:${quote}` : pair;
}
```

- [ ] **Step 4 : vérifier** — `npx vitest run lib/tools/exchange/symbols.test.ts` → PASS.

- [ ] **Step 5 : commit**

```bash
git add lib/tools/exchange/symbols.ts lib/tools/exchange/symbols.test.ts
git commit -m "exchange : normalisation des symboles"
```

---
### Task 4 : `errors.ts` — erreurs ccxt en français, `withRetry`

**Files:**
- Create: `lib/tools/exchange/errors.ts`
- Test: `lib/tools/exchange/errors.test.ts`

Les erreurs ccxt portent leur classe dans `error.name` (`InsufficientFunds`, `RateLimitExceeded`…). On s'appuie dessus plutôt que sur `instanceof`, pour rester pur et ne pas importer ccxt ici.

- [ ] **Step 1 : test**

```ts
import { describe, expect, test } from "vitest";
import { describeExchangeError, isTransientExchangeError, withRetry } from "./errors";

const err = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("describeExchangeError", () => {
  test("phrase francaise, puis le texte de l'exchange", () => {
    expect(describeExchangeError(err("InsufficientFunds", 'binance {"code":-2019,"msg":"Margin is insufficient."}'))).toBe(
      'Fonds insuffisants. Exchange : binance {"code":-2019,"msg":"Margin is insufficient."}',
    );
    expect(describeExchangeError(err("InvalidOrder", "x"))).toBe("Ordre refusé par l'exchange. Exchange : x");
    expect(describeExchangeError(err("AuthenticationError", "x"))).toBe("Clé API refusée : vérifiez le compte dans Authentification (bouton Tester). Exchange : x");
    expect(describeExchangeError(err("BadSymbol", "x"))).toBe("Marché inconnu sur cet exchange. Exchange : x");
    expect(describeExchangeError(err("RateLimitExceeded", "x"))).toBe("Trop de requêtes : l'exchange demande de ralentir. Exchange : x");
    expect(describeExchangeError(err("NetworkError", "x"))).toBe("L'exchange est injoignable. Exchange : x");
  });
  test("une erreur inconnue garde son texte", () => {
    expect(describeExchangeError(new Error("boom"))).toBe("L'exchange a répondu par une erreur. Exchange : boom");
    expect(describeExchangeError("texte")).toBe("L'exchange a répondu par une erreur. Exchange : texte");
  });
});

describe("withRetry", () => {
  test("reessaie une fois sur une erreur passagere", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      n++;
      if (n === 1) throw err("RequestTimeout", "t");
      return "ok";
    }, 0);
    expect(r).toBe("ok");
    expect(n).toBe(2);
  });
  test("ne reessaie pas une erreur franche, ni plus d'une fois", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw err("InvalidOrder", "x"); }, 0)).rejects.toThrow("x");
    expect(n).toBe(1);
    n = 0;
    await expect(withRetry(async () => { n++; throw err("NetworkError", "x"); }, 0)).rejects.toThrow("x");
    expect(n).toBe(2);
  });
});

test("isTransientExchangeError", () => {
  expect(isTransientExchangeError(err("DDoSProtection", ""))).toBe(true);
  expect(isTransientExchangeError(err("ExchangeNotAvailable", ""))).toBe(true);
  expect(isTransientExchangeError(err("InsufficientFunds", ""))).toBe(false);
});
```

- [ ] **Step 2 : échec** — `npx vitest run lib/tools/exchange/errors.test.ts` → FAIL.

- [ ] **Step 3 : implémentation**

```ts
/* ---------------------------------------------------------------------------
   Les erreurs de ccxt, dites en français.

   ccxt nomme ses erreurs par leur classe (`error.name`) ; on ne les
   importe pas ici, pour rester pur. Le texte brut de l'exchange suit
   toujours : c'est lui qui dit le code (-2019, marge insuffisante…).
--------------------------------------------------------------------------- */

const MESSAGES: Record<string, string> = {
  InsufficientFunds: "Fonds insuffisants.",
  InvalidOrder: "Ordre refusé par l'exchange.",
  OrderNotFound: "Ordre introuvable (déjà exécuté ou annulé ?).",
  BadSymbol: "Marché inconnu sur cet exchange.",
  BadRequest: "Requête refusée par l'exchange.",
  AuthenticationError: "Clé API refusée : vérifiez le compte dans Authentification (bouton Tester).",
  PermissionDenied: "La clé API n'a pas ce droit sur l'exchange.",
  AccountSuspended: "Compte suspendu par l'exchange.",
  RateLimitExceeded: "Trop de requêtes : l'exchange demande de ralentir.",
  DDoSProtection: "Trop de requêtes : l'exchange demande de ralentir.",
  NetworkError: "L'exchange est injoignable.",
  RequestTimeout: "L'exchange n'a pas répondu à temps.",
  ExchangeNotAvailable: "L'exchange est indisponible (maintenance ?).",
  NotSupported: "Cette opération n'est pas prise en charge par cet exchange.",
};

const TRANSIENT = new Set(["RateLimitExceeded", "DDoSProtection", "NetworkError", "RequestTimeout", "ExchangeNotAvailable"]);

const nameOf = (e: unknown) => (e instanceof Error ? e.name : "");
const textOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isTransientExchangeError = (e: unknown) => TRANSIENT.has(nameOf(e));

export function describeExchangeError(e: unknown): string {
  const head = MESSAGES[nameOf(e)] ?? "L'exchange a répondu par une erreur.";
  return `${head} Exchange : ${textOf(e)}`;
}

/** Un second essai, une seule fois, sur une erreur passagere. */
export async function withRetry<T>(fn: () => Promise<T>, wait = 1000): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransientExchangeError(e)) throw e;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  }
}
```

- [ ] **Step 4 : vérifier** — PASS.
- [ ] **Step 5 : commit** — `git add lib/tools/exchange/errors.ts lib/tools/exchange/errors.test.ts && git commit -m "exchange : erreurs ccxt en francais, second essai"`

---

### Task 5 : `format.ts` — soldes, positions, ordres, ticker en texte

**Files:**
- Create: `lib/tools/exchange/format.ts`
- Test: `lib/tools/exchange/format.test.ts`

Les types viennent de ccxt (`import type { Order, Position, Ticker, OrderBook, FundingRate } from "ccxt"`) ; les tests construisent des objets partiels castés.

- [ ] **Step 1 : test**

```ts
import { describe, expect, test } from "vitest";
import type { Order, Position, Ticker, OrderBook, FundingRate } from "ccxt";
import { formatBalance, formatOrders, formatPositions, formatTicker, n8 } from "./format";

test("n8 : jusqu'a 8 chiffres significatifs, sans zeros inutiles", () => {
  expect(n8(0.05)).toBe("0.05");
  expect(n8(67432.15)).toBe("67432.15");
  expect(n8(0.000012345678)).toBe("0.000012346");
  expect(n8(undefined)).toBe("–");
});

describe("formatBalance", () => {
  test("une ligne par actif, total en USD quand on le connait", () => {
    const rows = [
      { asset: "USDT", free: 1500, used: 500, total: 2000, usd: 2000 },
      { asset: "BTC", free: 0.05, used: 0, total: 0.05, usd: 3371.6 },
      { asset: "DOGE", free: 10, used: 0, total: 10 },
    ];
    expect(formatBalance("Binance-main", "spot", rows)).toBe(
      ["Binance-main · spot", "USDT : 2000 (libre 1500, bloqué 500) ≈ 2000 USD", "BTC : 0.05 (libre 0.05) ≈ 3371.6 USD", "DOGE : 10 (libre 10)", "Total ≈ 5371.6 USD (hors actifs sans prix)"].join("\n"),
    );
  });
  test("compte vide", () => {
    expect(formatBalance("Bybit-test", "futures", [])).toBe("Bybit-test · futures\nAucun solde.");
  });
});

describe("formatPositions", () => {
  test("cote, taille, entree, mark, PnL, levier, liquidation", () => {
    const p = [{ symbol: "BTC/USDT:USDT", side: "long", contracts: 0.05, contractSize: 1, entryPrice: 65000, markPrice: 67000, unrealizedPnl: 100, percentage: 3.08, leverage: 5, liquidationPrice: 52000, marginMode: "isolated" }] as unknown as Position[];
    expect(formatPositions(p)).toBe("BTC/USDT:USDT · LONG 0.05 · entrée 65000 · mark 67000 · PnL +100 (+3.08 %) · ×5 isolated · liquidation 52000 (−22.39 %)");
  });
  test("aucune position", () => {
    expect(formatPositions([])).toBe("Aucune position ouverte.");
    expect(formatPositions([{ symbol: "X", contracts: 0 }] as unknown as Position[])).toBe("Aucune position ouverte.");
  });
});

describe("formatOrders", () => {
  test("une ligne par ordre", () => {
    const o = [{ id: "123", symbol: "BTC/USDT", type: "limit", side: "buy", price: 60000, amount: 0.1, filled: 0.04, status: "open", timestamp: 1700000000000, fee: { cost: 0.12, currency: "USDT" } }] as unknown as Order[];
    expect(formatOrders(o)).toBe("2023-11-14T22:13:20Z · #123 · BTC/USDT · BUY limit 0.1 @ 60000 · rempli 0.04 · open · frais 0.12 USDT");
  });
  test("aucun ordre", () => {
    expect(formatOrders([])).toBe("Aucun ordre.");
  });
});

describe("formatTicker", () => {
  test("prix, carnet, funding", () => {
    const t = { symbol: "BTC/USDT:USDT", last: 67000, bid: 66999, ask: 67001, baseVolume: 12345.6, percentage: 1.2 } as unknown as Ticker;
    const book = { bids: [[66999, 1.5], [66998, 2]], asks: [[67001, 0.8]] } as unknown as OrderBook;
    const f = { fundingRate: 0.0001, fundingTimestamp: 1700000000000 } as unknown as FundingRate;
    expect(formatTicker(t, book, f)).toBe(
      ["BTC/USDT:USDT · last 67000 · bid 66999 / ask 67001 · 24 h +1.2 % · volume 12345.6", "Funding 0.01 % · prochain 2023-11-14T22:13:20Z", "Carnet :", "  ask 67001 × 0.8", "  bid 66999 × 1.5", "  bid 66998 × 2"].join("\n"),
    );
  });
  test("sans carnet ni funding", () => {
    expect(formatTicker({ symbol: "ETH/USDT", last: 3000 } as unknown as Ticker)).toBe("ETH/USDT · last 3000 · bid – / ask – · 24 h – · volume –");
  });
});
```

- [ ] **Step 2 : échec** — `npx vitest run lib/tools/exchange/format.test.ts` → FAIL.

- [ ] **Step 3 : implémentation**

```ts
import type { FundingRate, Order, OrderBook, Position, Ticker } from "ccxt";

/* Ce que le modele lit : une ligne par chose, des nombres courts, jamais
   le JSON brut de l'exchange (qui peserait dix fois plus). Pur. */

/** Jusqu'a 8 chiffres significatifs, sans zeros de fin. */
export const n8 = (n: number | undefined | null): string => (typeof n === "number" && Number.isFinite(n) ? Number(n.toPrecision(8)).toString() : "–");

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${n8(Math.abs(n))}`;
const pct = (n: number | undefined | null) => (typeof n === "number" ? `${signed(n)} %` : "–");
const iso = (ts: number | undefined) => (ts ? new Date(ts).toISOString().replace(".000Z", "Z") : "–");

export type BalanceRow = { asset: string; free: number; used: number; total: number; usd?: number };

export function formatBalance(label: string, market: string, rows: BalanceRow[]): string {
  const head = `${label} · ${market}`;
  if (rows.length === 0) return `${head}\nAucun solde.`;
  const lines = rows.map((r) => {
    const parts = [`libre ${n8(r.free)}`];
    if (r.used > 0) parts.push(`bloqué ${n8(r.used)}`);
    return `${r.asset} : ${n8(r.total)} (${parts.join(", ")})${r.usd !== undefined ? ` ≈ ${n8(r.usd)} USD` : ""}`;
  });
  const priced = rows.filter((r) => r.usd !== undefined);
  const total = priced.reduce((s, r) => s + (r.usd ?? 0), 0);
  const note = priced.length < rows.length ? " (hors actifs sans prix)" : "";
  return [head, ...lines, `Total ≈ ${n8(total)} USD${note}`].join("\n");
}

export function formatPositions(positions: Position[]): string {
  const open = positions.filter((p) => (p.contracts ?? 0) > 0);
  if (open.length === 0) return "Aucune position ouverte.";
  return open
    .map((p) => {
      const size = (p.contracts ?? 0) * (p.contractSize ?? 1);
      const parts = [`${p.symbol} · ${(p.side ?? "?").toUpperCase()} ${n8(size)}`, `entrée ${n8(p.entryPrice)}`, `mark ${n8(p.markPrice)}`];
      if (typeof p.unrealizedPnl === "number") parts.push(`PnL ${signed(p.unrealizedPnl)} (${pct(p.percentage)})`);
      if (p.leverage) parts.push(`×${n8(p.leverage)}${p.marginMode ? ` ${p.marginMode}` : ""}`);
      if (p.liquidationPrice && p.markPrice) {
        const dist = ((p.liquidationPrice - p.markPrice) / p.markPrice) * 100;
        parts.push(`liquidation ${n8(p.liquidationPrice)} (${signed(Number(dist.toFixed(2)))} %)`);
      }
      return parts.join(" · ");
    })
    .join("\n");
}

export function formatOrders(orders: Order[]): string {
  if (orders.length === 0) return "Aucun ordre.";
  return orders
    .map((o) => {
      const parts = [iso(o.timestamp), `#${o.id}`, o.symbol, `${(o.side ?? "?").toUpperCase()} ${o.type} ${n8(o.amount)}${o.price ? ` @ ${n8(o.price)}` : ""}`];
      if (o.filled) parts.push(`rempli ${n8(o.filled)}${o.average ? ` (moy. ${n8(o.average)})` : ""}`);
      parts.push(String(o.status ?? "?"));
      if (o.fee?.cost) parts.push(`frais ${n8(o.fee.cost)} ${o.fee.currency ?? ""}`.trim());
      return parts.join(" · ");
    })
    .join("\n");
}

export function formatTicker(t: Ticker, book?: OrderBook, funding?: FundingRate): string {
  const lines = [`${t.symbol} · last ${n8(t.last)} · bid ${n8(t.bid)} / ask ${n8(t.ask)} · 24 h ${pct(t.percentage)} · volume ${n8(t.baseVolume)}`];
  if (funding && typeof funding.fundingRate === "number") {
    lines.push(`Funding ${n8(funding.fundingRate * 100)} % · prochain ${iso(funding.fundingTimestamp ?? funding.nextFundingTimestamp ?? undefined)}`);
  }
  if (book) {
    lines.push("Carnet :");
    for (const [p, a] of [...book.asks].reverse()) lines.push(`  ask ${n8(p)} × ${n8(a)}`);
    for (const [p, a] of book.bids) lines.push(`  bid ${n8(p)} × ${n8(a)}`);
  }
  return lines.join("\n");
}
```

Note : ccxt type `OrderBook.asks` comme `[number, number][]` (ou `Num[]`) ; si le typecheck se plaint, caster `p as number`.

- [ ] **Step 4 : vérifier** — `npx vitest run lib/tools/exchange/format.test.ts && npm run typecheck` → PASS. Si un test de `formatPositions` diffère sur l'arrondi de la distance de liquidation, ajuster la valeur attendue au résultat de `((52000-67000)/67000*100).toFixed(2)` = `-22.39`.

- [ ] **Step 5 : commit** — `git add lib/tools/exchange/format.ts lib/tools/exchange/format.test.ts && git commit -m "exchange : mise en forme des soldes, positions, ordres, ticker"`

---

### Task 6 : `client.ts` et `common.ts` — l'adaptateur ccxt et le tronc commun des outils

**Files:**
- Create: `lib/tools/exchange/client.ts`
- Create: `lib/tools/exchange/common.ts`
- Modify: `lib/tools/types.ts:38-58` (ToolContext)

Pas de test unitaire pour `client.ts` (c'est une enveloppe de ccxt) ; `common.ts` est couvert par les tests des outils (Task 8+), qui remplacent `clientFor` par `vi.mock("./client")`.

- [ ] **Step 1 : `ToolContext.exchangeAccounts`**

Dans `lib/tools/types.ts`, après `bytnodeKey?: string;` :

```ts
  /** Les comptes d'exchange que l'agent peut piloter (deja filtres). */
  exchangeAccounts?: ExchangeAccount[];
```

et `import type { ExchangeAccount } from "@/lib/domain/types";` en tête.

- [ ] **Step 2 : `client.ts`**

```ts
import ccxt, { type Exchange } from "ccxt";
import { createHash } from "node:crypto";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { Market } from "./symbols";

/* ---------------------------------------------------------------------------
   Une instance ccxt par compte et par marche, gardee en memoire.

   ⚠️ SERVEUR SEULEMENT. `loadMarkets` coute une requete et une seconde :
   on le fait une fois par instance. Le cache est indexe par une empreinte
   de la cle, jamais par la cle elle-meme. Aucune methode de retrait n'est
   exposee par les outils ; ce module ne fait qu'ouvrir la connexion.
--------------------------------------------------------------------------- */

const cache = new Map<string, Promise<Exchange>>();

const fingerprint = (a: ExchangeAccount, market: Market) =>
  createHash("sha256").update(`${a.exchange}|${a.apiKey}|${a.secret}|${a.testnet}|${market}`).digest("hex");

export async function clientFor(account: ExchangeAccount, market: Market): Promise<Exchange> {
  const key = fingerprint(account, market);
  let hit = cache.get(key);
  if (!hit) {
    hit = open(account, market).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, hit);
  }
  return hit;
}

async function open(account: ExchangeAccount, market: Market): Promise<Exchange> {
  const Ctor = (ccxt as unknown as Record<string, new (config: Record<string, unknown>) => Exchange>)[account.exchange];
  if (!Ctor) throw Object.assign(new Error(`Exchange inconnu de ccxt : ${account.exchange}`), { name: "NotSupported" });
  const ex = new Ctor({
    apiKey: account.apiKey,
    secret: account.secret,
    ...(account.password ? { password: account.password } : {}),
    enableRateLimit: true,
    options: { defaultType: market === "futures" ? "swap" : "spot" },
  });
  if (account.testnet) ex.setSandboxMode(true);
  await ex.loadMarkets();
  return ex;
}
```

- [ ] **Step 3 : `common.ts`**

```ts
import type { Exchange } from "ccxt";
import type { ToolContext } from "../types";
import { fail, type ToolResult } from "../types";
import { pickAccount } from "./accounts";
import { clientFor } from "./client";
import { describeExchangeError, withRetry } from "./errors";
import { toSymbol, type Market } from "./symbols";
import type { ExchangeAccount } from "@/lib/domain/types";

/* Ce que chaque outil exchange fait avant de travailler : trouver le compte,
   ouvrir le client, normaliser le symbole. Et apres : traduire l'erreur. */

export type BaseArgs = { account?: string; market?: Market };

export const MARKET_PROP = { type: "string", enum: ["spot", "futures"], description: "Le marché : `spot` (défaut) ou `futures` (perpétuels linéaires USDT)." };
export const ACCOUNT_PROP = { type: "string", description: "Le compte, par son label (« Binance-main »). Obligatoire s'il y a plusieurs comptes." };
export const SYMBOL_PROP = { type: "string", description: "La paire, format `BTC/USDT` (le suffixe perp est ajouté en futures)." };

export type Resolved = { account: ExchangeAccount; market: Market; ex: Exchange };

export async function resolve(args: BaseArgs, ctx: ToolContext): Promise<Resolved | { error: string }> {
  const picked = pickAccount(ctx.exchangeAccounts ?? [], args.account);
  if ("error" in picked) return picked;
  const market: Market = args.market === "futures" ? "futures" : "spot";
  try {
    const ex = await clientFor(picked.account, market);
    return { account: picked.account, market, ex };
  } catch (e) {
    return { error: describeExchangeError(e) };
  }
}

/** Un symbole valide sur cet exchange, ou une erreur qui le dit. */
export function symbolOn(ex: Exchange, raw: string, market: Market): { symbol: string } | { error: string } {
  const symbol = toSymbol(raw, market);
  if (!ex.markets?.[symbol]) return { error: `Marché inconnu sur ${ex.id} : ${symbol}.` };
  return { symbol };
}

/** Execute un appel exchange : un second essai si passager, l'erreur en
    francais sinon. */
export async function attempt(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await withRetry(fn);
  } catch (e) {
    return fail(describeExchangeError(e));
  }
}

/** Refuse le hedge mode (long et short a la fois) : les outils ne savent
    que le one-way. `undefined` si l'exchange ne le dit pas. */
export async function hedgeModeError(ex: Exchange, symbol: string): Promise<string | undefined> {
  if (!ex.has["fetchPositionMode"]) return undefined;
  try {
    const mode = (await ex.fetchPositionMode(symbol)) as { hedged?: boolean };
    if (mode?.hedged) return "Ce compte est en hedge mode : les outils ne gèrent que le one-way. Repassez en one-way sur l'exchange.";
  } catch {
    /* pas grave : l'exchange tranchera */
  }
  return undefined;
}
```

- [ ] **Step 4 : typecheck** — `npm run typecheck` → propre (adapter les casts si les types ccxt divergent : `ex.has` est `Dictionary<boolean | 'emulated'>`, `fetchPositionMode` existe sur `Exchange`).

- [ ] **Step 5 : commit** — `git add lib/tools/types.ts lib/tools/exchange/client.ts lib/tools/exchange/common.ts && git commit -m "exchange : client ccxt cache et tronc commun des outils"`

---
## Tâches 7 à 22 — format condensé

Chaque tâche suit le même cycle : test qui échoue → implémentation → `npx vitest run <fichier>` → `npm run typecheck && npm run lint` → commit. Les tests d'outils remplacent le client par `vi.mock("./client", () => ({ clientFor: vi.fn() }))` et donnent un faux `Exchange` (`as unknown as Exchange`) avec `markets`, `has`, `amountToPrecision`, et les méthodes appelées. Le `ctx` de test : copier celui de `lib/tools/todo.test.ts` en ajoutant `exchangeAccounts: [main]`.

### Task 7 : transport des comptes (serveur ↔ navigateur)

- `lib/tools/registry.ts` : `allTools({ platform, bytnodeKey, exchangeAccounts })` → si `exchangeAccounts?.length`, ajouter `...exchangeTools()` (créé en Task 8, commencer par un tableau vide dans `lib/tools/exchange/index.ts`).
- `app/api/tools/route.ts` et `app/api/tools/execute/route.ts` : `const exchangeAccounts = parseAccountsHeader(req.headers.get("x-exchange-accounts"))`, passé à `allTools` et dans `ctx.exchangeAccounts`.
- `lib/tools/agents/workflow.ts:74` : passer `exchangeAccounts: ctx.exchangeAccounts` ; le `ctx` des sous-agents doit propager `exchangeAccounts`.
- `lib/tools/client.ts` : `fetchToolset(…, bytnodeKey, exchangeAccounts: ExchangeAccount[], force)` — clé de cache + `JSON.stringify(ids)` ; en-tête `x-exchange-accounts: JSON.stringify(exchangeAccounts)` si non vide. `ExecuteParams.exchangeAccounts`, même en-tête sur `executeTool`.
- `components/chat/use-chat.ts` : `const exchangeAccounts = allowedAccounts(settings.keys.exchanges, agent.exchangeAccountIds)` calculé dans `turn`, passé à `fetchToolset` et à `exec`.
- Test : `lib/tools/exchange/accounts.test.ts` couvre déjà le parse ; ajouter dans `lib/tools/registry` un test minimal ? Non — registry est serveur-only (fs). Vérifier par typecheck.
- Commit : `exchange : transport des comptes vers les routes outils`.

### Task 8 : `ExchangeBalance` (`balance.ts`, `index.ts`)

- `execute({account?, market?})` → `resolve` ; `ex.fetchBalance()` ; lignes = entrées de `balance.total` > 0 ; ≈ USD : stables (`USDT|USDC|USD|FDUSD|BUSD|DAI`) = 1:1 ; sinon si `has.fetchTickers` et `markets[`${asset}/USDT`]` → `fetchTickers(symbols)` en un appel, `last × total` ; échec ou marché absent → pas de `usd`. `ok(formatBalance(account.label, market, rows))`.
- `index.ts` : `export const exchangeTools = (): Tool[] => [balanceTool, …] as Tool[]` (compléter à chaque outil).
- Tests (`balance.test.ts`) : chemin heureux avec 3 actifs (un stable, un coté, un sans marché) → texte exact ; `AuthenticationError` → `ok:false`, output commence par « Clé API refusée » ; deux comptes sans `account` → erreur « Plusieurs comptes ».
- Commit : `exchange : ExchangeBalance`.

### Task 9 : `ExchangePositions` (`positions.ts`)

- Forcer `market = "futures"` (argument `market` absent du schéma). `ex.fetchPositions(symbol ? [symbol] : undefined)` → `formatPositions`. Si `has.fetchPositions` faux → `fail("Cet exchange ne publie pas les positions via ccxt.")`.
- Tests : une position longue → ligne attendue (celle du test de `format`) ; aucune → « Aucune position ouverte. » ; `symbol` filtré passe par `symbolOn` (marché inconnu → erreur).
- Commit : `exchange : ExchangePositions`.

### Task 10 : `ExchangeOrders` (`orders.ts`)

- Args `status: "open"|"closed"` (requis), `symbol?`, `since?` (ISO ou ms), `limit?` (1–200, défaut 50). `open` → `fetchOpenOrders(symbol, since, limit)` ; `closed` → `fetchClosedOrders` si `has.fetchClosedOrders`, sinon `fetchOrders` filtré `status !== "open"`. `formatOrders`.
- Tests : open avec un ordre → ligne exacte ; closed sur un exchange sans `fetchClosedOrders` → repli sur `fetchOrders` ; `since: "2024-01-01"` → converti en ms dans l'appel (vérifier l'argument reçu par le mock).
- Commit : `exchange : ExchangeOrders`.

### Task 11 : `ExchangeTicker` (`ticker.ts`)

- Args `symbol` (requis), `account?`, `market?`, `depth?` (0–50, défaut 5). `fetchTicker` ; si `depth > 0` → `fetchOrderBook(symbol, depth)` ; si futures et `has.fetchFundingRate` → `fetchFundingRate`. Les deux annexes sont optionnelles : une erreur sur elles est ignorée (le ticker seul suffit). `formatTicker`.
- Tests : futures avec carnet + funding → texte exact ; spot `depth: 0` → une ligne ; `fetchOrderBook` qui jette → ticker quand même.
- Commit : `exchange : ExchangeTicker`.

### Task 12 : permissions — `GATED_TOOLS`, `ALWAYS_ASK`, libellés, UI de la demande

- `lib/tools/names.ts` : `GATED_TOOLS` += `PlaceOrder, CancelOrder, ClosePosition, Transfer, SetLeverage` ; `export const ALWAYS_ASK = new Set(["PlaceOrder", "ClosePosition", "Transfer"])`, `export const alwaysAsks = (name) => ALWAYS_ASK.has(name)`. `summarizeCall` :
  - `ExchangeBalance`/`ExchangePositions` → `account · market`
  - `ExchangeOrders` → `account · status symbol`
  - `ExchangeTicker`/`ExchangeWatch` → `account · symbol`
  - `PlaceOrder` → `` `${account} · ${side.toUpperCase()} ${amount ?? `${quoteAmount} (quote)`} ${symbol} ${type}${price ? ` @ ${price}` : ""}${leverage ? ` ×${leverage}` : ""}${reduceOnly ? " reduceOnly" : ""}` ``
  - `CancelOrder` → `all ? `tous les ordres ${symbol}` : `#${orderId}``
  - `ClosePosition` → `` `${account} · ${symbol}${fraction && fraction < 1 ? ` ${fraction*100} %` : ""}` ``
  - `Transfer` → `` `${amount} ${asset} ${from} → ${to}` ``
  - `SetLeverage` → `` `${symbol} ×${leverage}${marginMode ? ` ${marginMode}` : ""}` ``
- Créer `lib/tools/names.test.ts` : un `it` par libellé ci-dessus, plus `alwaysAsks("PlaceOrder") === true`, `alwaysAsks("CancelOrder") === false`, `isGated("Transfer") === true`.
- `lib/tools/permissions.ts` : `ruleFor` → `null` si `alwaysAsks(name)` ; `matchesRule` → `false` si `alwaysAsks(name)`. Tests dans `permissions.test.ts` : `ruleFor("PlaceOrder", {...})` null ; `matchesRule(["PlaceOrder"], "PlaceOrder", {})` false ; `matchesRule(["CancelOrder"], "CancelOrder", {})` true.
- `components/chat/use-chat.ts:565` : `gated: (name) => alwaysAsks(name) || (!skipAll.current && isGated(name))`.
- `components/chat/tool-step.tsx` `Ask` : `const fonds = alwaysAsks(step.name)` ; texte « Cette action engage des fonds. À autoriser une fois, en connaissance de cause. » ; pas de bouton Toujours (`rule = dangereux || fonds ? null : ruleFor(...)`) ; classe `is-danger` aussi quand `fonds`. Badge : `const settings = useSettings()`, `const picked = pickAccount(settings.keys.exchanges, step.args.account)` ; si l'outil commence par `Exchange`/est dans `GATED` exchange → `<span className={`ts-badge ${live ? "is-live" : ""}`}>{live ? "RÉEL" : "TESTNET"}</span>` où `live = !("account" in picked) || !picked.account.testnet` (ambigu ⇒ RÉEL). CSS dans `components/chat/chat.css` (ou le fichier CSS du fil) : `.ts-badge` pilule mono 10px, `.is-live` fond rouge `#b3261e`, texte blanc.
- Commit : `exchange : permissions toujours demandees, libelles, badge REEL/TESTNET`.

### Task 13 : `PlaceOrder` (`place-order.ts`)

- Schéma : `symbol` (req), `side: buy|sell` (req), `type: market|limit|stop|stop_limit|take_profit` (req), `amount?`, `quoteAmount?`, `price?`, `stopPrice?`, `reduceOnly?`, `leverage?` (1–125), `postOnly?`, `timeInForce?: GTC|IOC|FOK`, `account?`, `market?`, `additionalProperties: false`.
- Règles avant l'appel : exactement un de `amount`/`quoteAmount` ; `limit`/`stop_limit` exigent `price` ; `stop`/`stop_limit`/`take_profit` exigent `stopPrice` ; futures → `hedgeModeError` ; `quoteAmount` → `fetchTicker(symbol).last` → `amount = quoteAmount / last` ; `amount = Number(ex.amountToPrecision(symbol, amount))` ; refus si `< markets[symbol].limits.amount.min` (« Quantité 0.00001 sous le minimum 0.0001 BTC. ») ; `price` via `priceToPrecision`.
- `leverage` en futures → `ex.setLeverage(leverage, symbol)` avant l'ordre.
- Mapping ccxt : `market`/`limit` directs ; `stop` → `createOrder(symbol, "market", side, amount, undefined, { triggerPrice: stopPrice, ...params })` ; `stop_limit` → `("limit", price, { triggerPrice })` ; `take_profit` → `("market", undefined, { takeProfitPrice: stopPrice })`. `params` : `reduceOnly`, `postOnly`, `timeInForce` si donnés.
- Retour : `` `Ordre #${o.id} ${status} · ${SIDE} ${n8(o.amount)} ${symbol} ${type}${o.average ? ` · moyen ${n8(o.average)}` : ""}${o.filled ? ` · rempli ${n8(o.filled)}` : ""}` ``.
- Tests : market spot heureux (vérifier les arguments reçus par `createOrder`) ; `quoteAmount: 200` avec `last: 50000` → `amount 0.004` ; `amount` + `quoteAmount` → refus ; `limit` sans `price` → refus ; sous le minimum → refus ; `stop_limit` → `triggerPrice` dans params ; `InsufficientFunds` → « Fonds insuffisants. » ; hedge mode → refus.
- Commit : `exchange : PlaceOrder`.

### Task 14 : `CancelOrder` (`cancel-order.ts`)

- `orderId?` + `symbol?` **ou** `symbol` + `all: true`. `cancelOrder(orderId, symbol)` ou `cancelAllOrders(symbol)`. Retour « Ordre #id annulé. » / « N ordre(s) annulé(s) sur SYMBOL. » (N = longueur si tableau, sinon « Tous les ordres … annulés. »). `OrderNotFound` → message dédié.
- Tests : un id ; `all` ; ni l'un ni l'autre → refus.
- Commit : `exchange : CancelOrder`.

### Task 15 : `ClosePosition` (`close-position.ts`)

- Futures forcé. `fetchPositions([symbol])` → position avec `contracts > 0`, sinon « Aucune position ouverte sur SYMBOL. ». `hedgeModeError`. `amount = amountToPrecision(contracts × fraction)` ; `createOrder(symbol, "market", side === "long" ? "sell" : "buy", amount, undefined, { reduceOnly: true })`. Retour « Position SYMBOL LONG fermée à 50 % (0.025) · ordre #id ».
- Tests : fermeture totale (vérifier `side` inverse et `reduceOnly`) ; `fraction: 0.5` ; aucune position → refus ; `fraction: 0` ou `> 1` → refus par le schéma (`minimum: 0.01, maximum: 1`).
- Commit : `exchange : ClosePosition`.

### Task 16 : `Transfer` (`transfer.ts`)

- `asset` (req), `amount` (req, `minimum > 0`), `from: spot|futures` (req), `to: spot|futures` (req), `from !== to`. `ex.transfer(asset.toUpperCase(), amount, from === "futures" ? "swap" : "spot", to === "futures" ? "swap" : "spot")`. Retour « Transfert #id : 100 USDT spot → futures. ». Description de l'outil : « Interne au compte uniquement — aucun retrait externe n'existe. »
- Tests : heureux (vérifier `swap`) ; `from === to` → refus ; `NotSupported` → message.
- Commit : `exchange : Transfer`.

### Task 17 : `SetLeverage` (`set-leverage.ts`)

- Futures forcé. `leverage` (1–125), `marginMode?`. `setMarginMode(marginMode, symbol)` d'abord si donné (erreur « déjà dans ce mode » de certains exchanges ignorée si le message la contient — sinon propagée), puis `setLeverage(leverage, symbol)`. Retour « SYMBOL : levier ×5 (isolated). ».
- Tests : heureux ; hors bornes → refus par le schéma ; erreur exchange → français.
- Commit : `exchange : SetLeverage`.

### Task 18 : `watch-until.ts` + `ExchangeWatch` (`watch.ts`)

- `watch-until.ts` (pur, testé) : `parseUntil(text): Condition | { error }` avec grammaire `^(pnl|pnl%|price|liq)\s*(<=|>=|<|>)\s*(-?\d+(\.\d+)?)\s*%?$` ou `closed` ; `type Sample = { price: number; pnl?: number; pnlPct?: number; liqPct?: number; open: boolean }` ; `holds(cond, sample): boolean` (`liq` compare la distance en % à la liquidation, valeur absolue ; `pnl`/`pnl%`/`liq` sont faux si la donnée manque ; `closed` = `!open`). Tests : chaque champ, chaque opérateur, expression invalide → erreur, `liq<3%` avec `liqPct: 2.5` → vrai.
- `ExchangeWatch` : `symbol` (req), `account?`, `market?`, `every?` (s, 5–300, défaut 30), `timeout?` (ms, 5000–600000, défaut 300000), `until?`. Boucle : relevé = `fetchTicker` (+ `fetchPositions([symbol])` en futures) → `Sample` → ligne `HH:MM:SS · mark 67000 · PnL +100 (+3.08 %) · liquidation à 22.4 %` émise par `ctx.emit({ type: "tool_line", id: ctx.callId, line })` (même événement que `Monitor`) ; arrêt si `holds` vrai, si position fermée alors qu'elle était ouverte au premier relevé, `ctx.signal.aborted`, ou temps écoulé. Attente entre relevés : `setTimeout` annulable par le signal. Retour : les lignes (max 200) + « Arrêt : condition `price>=70000` atteinte » / « … position fermée » / « … temps écoulé (5 min) ». Une erreur transitoire pendant un relevé compte comme une ligne « (relevé manqué : …) » et la boucle continue ; trois manqués consécutifs → arrêt en erreur.
- Tests (`watch.test.ts`, `vi.useFakeTimers`) : `until: "price>=70000"` atteint au 2e relevé → 2 lignes, arrêt sur condition ; timeout → arrêt « temps écoulé » ; `until` invalide → refus immédiat ; abort du signal → sortie propre.
- Commit : `exchange : ExchangeWatch et grammaire until`.

### Task 19 : prompt

- `lib/agent/tools-prompt.ts` : nouveau paramètre `exchangeAccounts?: ExchangeAccount[]` ; si non vide, section « ## Comptes exchange » : `Comptes : ${describeAccounts(accounts)}.` + règles : « Avant tout ordre : ExchangeBalance puis ExchangeTicker ; calcule la quantité en actif de base (ou donne `quoteAmount`) ; après un ordre, confirme avec ExchangeOrders. Un ordre, une fermeture ou un transfert demande TOUJOURS l'accord de l'utilisateur : ne les enchaîne pas, attends le résultat. Aucun retrait externe n'existe. Compétences : `trading-execution`, `trade-review`. » ; `RÉEL` mis en avant : « Les comptes marqués RÉEL engagent de l'argent réel. »
- `use-chat.ts` : passer `exchangeAccounts` aux deux appels (`buildToolsPrompt` et `buildAcpPrompt` — ajouter le même paramètre à `buildAcpPrompt` dans `lib/acp/prompt.ts` ou équivalent, réutilisant la même fonction de section).
- Test : `lib/agent/tools-prompt.test.ts` (créer s'il n'existe pas) : avec un compte RÉEL → contient « Binance-main (binance, RÉEL) » et « TOUJOURS » ; sans compte → pas de section.
- Commit : `exchange : section du prompt`.

### Task 20 : UI Authentification + `/api/exchange/check`

- `app/api/exchange/check/route.ts` : `POST` corps `{ account }` → `parseAccounts([account])[0]` sinon 400 ; `clientFor(account, "spot")` puis `fetchBalance()` → `{ ok: true, message: "N actifs" }` ; erreur → `{ ok: false, message: describeExchangeError(e) }` (200, pas 500 : c'est un diagnostic). Ne jamais logger le corps.
- `components/onboarding/exchange-accounts.tsx` : `ExchangeAccounts({ value: ExchangeAccount[], onChange })`. Liste : label, exchange, badge TESTNET/RÉEL, bouton Tester (état idle/checking/ok/bad comme `KeyField`), Supprimer (confirmation inline). Formulaire d'ajout : `<select>` sur `EXCHANGES`, label, apiKey, secret (type password + œil), password si `exchangeInfo(id).password`, case « Réseau de test » désactivée si `!testnet`. `id` = `crypto.randomUUID()` au clic Ajouter (pas en rendu — règle React Compiler).
- `step-auth.tsx` : sous la clé BytNode, `<div className="ob-sub"><ExchangeAccounts value={keys.exchanges} onChange={(exchanges) => onKeys({ ...keys, exchanges })} /></div>`.
- CSS dans `components/onboarding/onboarding.css` : `.ob-xch-list`, `.ob-xch-row`, `.ob-badge.is-live`.
- Vérification : `npm run typecheck && npm run lint` ; pas de test unitaire (UI).
- Commit : `exchange : comptes dans Authentification, route de test`.

### Task 21 : UI agent + en-tête de conversation

- `wizard.tsx` : `<StepAgent … exchanges={draft.keys.exchanges} />` ; `step-agent.tsx` : prop `exchanges: ExchangeAccount[]` ; si non vide, bloc « Comptes exchange » — une case à cocher par compte (label, exchange, badge), `set({ exchangeAccountIds: toggled })` ; si vide, phrase « Ajoutez un compte dans Authentification pour que cet agent puisse trader. »
- `chat-shell.tsx` en-tête : si `allowedAccounts(settings.keys.exchanges, agent.exchangeAccountIds).length > 0`, badge `RÉEL` (si un compte au moins n'est pas testnet) sinon `TESTNET`, title = `describeAccounts(...)`.
- Commit : `exchange : choix des comptes par agent, badge dans l'en-tete`.

### Task 22 : ACP

- `lib/acp/sessions.ts` : `TurnInput.exchangeAccounts: ExchangeAccount[]` ; `mcpServersFor(workspace, bytnodeKey, exchangeAccounts)` ajoute `{ name: "BYTNODE_AI_EXCHANGE_ACCOUNTS", value: JSON.stringify(exchangeAccounts) }` (chaîne vide si aucun) ; `serversKey` change donc avec les comptes (session recréée — voulu). Dans le handler de permission (`:320-333`) : `const auto = input.permissionMode === "skip" && !isAlwaysAskTitle(req.toolCall.title ?? "")` où `isAlwaysAskTitle(title) = [...ALWAYS_ASK].some((n) => title.includes(n))` ajouté à `names.ts` (test : `"mcp__bytnode-ai__PlaceOrder"` → vrai, `"Read file"` → faux).
- `app/api/acp/prompt/route.ts` : `exchangeAccounts: parseAccounts(body.exchangeAccounts)` ; `lib/acp/client.ts` : champ `exchangeAccounts` dans le corps ; `use-chat.ts` : le passer à `runAcpTurn`.
- `lib/mcp/finance-server.ts` : `const exchangeAccounts = parseAccountsHeader(process.env.BYTNODE_AI_EXCHANGE_ACCOUNTS)` ; `TOOLS = [...finance, ...(exchangeAccounts.length ? exchangeTools() : [])]` ; `ctx.exchangeAccounts`. `emit` reste `() => {}` : les lignes d'`ExchangeWatch` ne remontent pas côté ACP — l'outil rend ses lignes dans `output`, c'est suffisant.
- Limite à documenter (CLAUDE.md) : un agent externe placé par l'utilisateur dans un mode qui contourne les permissions (« bypass ») peut ne pas nous demander pour un outil MCP ; BytNode-AI force la demande dès que l'agent la pose.
- Vérification : typecheck/lint/test ; puis un tour réel court avec Claude (`haiku`, `effort: low`) et un compte **testnet** : « quel est mon solde ? » → `ExchangeBalance` visible dans le fil.
- Commit : `exchange : outils exposes aux agents ACP, permission forcee`.

### Task 23 : skills

- `professions/_commun/skills/trading-execution/SKILL.md` (front-matter `name: trading-execution`, `description: Passer un ordre proprement : solde, prix, taille, ordre, confirmation.`) : la méthode en 6 étapes, la conversion quote → base, le choix market/limit, `reduceOnly` pour sortir, ne jamais enchaîner deux ordres sans lire le résultat, annoncer clairement RÉEL vs testnet.
- `professions/_commun/skills/trade-review/SKILL.md` (`name: trade-review`) : revue de positions (PnL, distance à la liquidation < 10 % = alerte, funding cumulé, exposition par actif) et d'historique (`ExchangeOrders closed` → `SaveMarketData` impossible ici : écrire le CSV avec `Write` → `Chart`), gabarit de rapport.
- Commit : `exchange : competences trading-execution et trade-review`.

### Task 24 : documentation

- `CLAUDE.md` : paragraphe **Exchange trading** dans Architecture (transport des comptes, `ALWAYS_ASK`, `clientFor` cache, one-way, pas de retrait, ACP via env, limite bypass) ; `ccxt` dans la liste `serverExternalPackages` ; « never call a real exchange in tests, verify on testnet ».
- `README.md` : section utilisateur — ajouter un compte, choisir les comptes d'un agent, ce que l'agent peut faire, ce qui demande toujours l'accord.
- Commit : `exchange : documentation`.

---

## Vérification finale

1. `npm run typecheck && npm run lint && npm test` — tout propre.
2. Avec l'utilisateur (son `next dev` sur 3777, compte **testnet** Binance ou Bybit) : ajouter le compte → Tester OK ; agent OpenRouter avec ce compte : « solde ? », « prix BTC futures avec carnet », « achète 20 USDT de BTC au marché » (bouton Autoriser, badge TESTNET, pas de Toujours), « mes ordres exécutés », « surveille BTC 1 min toutes les 10 s jusqu'à price>=… ». Puis le même agent en mode Exécution directe : l'ordre demande quand même.
3. Agent Claude (ACP) : « solde ? » → `ExchangeBalance` via MCP.

## Auto-revue (faite)

- Couverture spec : comptes/clés (T1, T2, T7, T20, T21), dix outils (T8–T18), toujours demander + badge (T12, T22), quoteAmount (T13), one-way (T6 `hedgeModeError`, T13, T15), ExchangeWatch (T18), dix exchanges (T2), ACP (T22), skills (T23), prompt (T19), doc (T24). Hors périmètre respecté (pas de retrait, pas de journal).
- Cohérence des noms : `parseAccounts` / `parseAccountsHeader` / `pickAccount` / `allowedAccounts` / `describeAccounts` (T2) ; `toSymbol`, `Market` (T3) ; `describeExchangeError`, `withRetry` (T4) ; `n8`, `formatBalance`, `formatPositions`, `formatOrders`, `formatTicker` (T5) ; `clientFor`, `resolve`, `symbolOn`, `attempt`, `hedgeModeError` (T6) ; `exchangeTools` (T8) ; `ALWAYS_ASK`, `alwaysAsks`, `isAlwaysAskTitle` (T12, T22) ; `parseUntil`, `holds`, `Sample` (T18).
