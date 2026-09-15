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
  createHash("sha256").update(`${a.exchange}|${a.apiKey}|${a.secret}|${a.password}|${a.testnet}|${market}`).digest("hex");

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

type Ctor = new (config: Record<string, unknown>) => Exchange;

async function open(account: ExchangeAccount, market: Market): Promise<Exchange> {
  /* Seuls les ids publies par ccxt : jamais une propriete quelconque de
     l'objet (`constructor`, `Exchange`…) prise pour un exchange. */
  if (!ccxt.exchanges.includes(account.exchange)) throw Object.assign(new Error(`Exchange inconnu de ccxt : ${account.exchange}`), { name: "NotSupported" });
  const Klass = (ccxt as unknown as Record<string, Ctor>)[account.exchange];
  const ex = new Klass({
    apiKey: account.apiKey,
    secret: account.secret,
    ...(account.password ? { password: account.password } : {}),
    enableRateLimit: true,
    options: {
      defaultType: market === "futures" ? "swap" : "spot",
      /* L'horloge d'un PC derive de quelques secondes ; l'exchange refuse
         une requete datee hors de sa fenetre (Bybit 10002, Binance -1021).
         ccxt mesure l'ecart a `loadMarkets` et date les requetes a l'heure
         de l'exchange ; la fenetre elargie absorbe la derive d'apres. */
      adjustForTimeDifference: true,
      recvWindow: 20_000,
    },
  });
  if (account.testnet) ex.setSandboxMode(true);
  await ex.loadMarkets();
  return ex;
}
