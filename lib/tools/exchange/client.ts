import ccxt, { type Exchange } from "ccxt";
import { createHash } from "node:crypto";
import type { ExchangeAccount } from "@/lib/domain/types";
import { pemSecret } from "./accounts";
import { ccxtIdFor } from "./catalog";
import type { Market } from "./symbols";

/* ---------------------------------------------------------------------------
   Une instance ccxt par compte et par marche, gardee en memoire.

   ⚠️ SERVEUR SEULEMENT. `loadMarkets` coute une requete et une seconde :
   on le fait une fois par instance. Le cache est indexe par une empreinte
   de la cle, jamais par la cle elle-meme. Aucune methode de retrait n'est
   exposee par les outils ; ce module ne fait qu'ouvrir la connexion.
--------------------------------------------------------------------------- */

const cache = new Map<string, Promise<Exchange>>();
/** Quand l'ecart d'horloge de chaque client a ete mesure pour la derniere fois. */
const synced = new Map<string, number>();
/** Au-dela, on remesure : l'horloge du PC derive, et Bybit ou Binance
    refusent une requete datee plus d'une seconde APRES leur heure. */
const RESYNC_MS = 10 * 60_000;

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
  const ex = await hit;
  if (Date.now() - (synced.get(key) ?? 0) > RESYNC_MS) {
    synced.set(key, Date.now());
    await syncClock(ex);
  }
  return ex;
}

/** Mesure l'ecart entre l'horloge du PC et celle de l'exchange ; ccxt date
    ensuite chaque requete a l'heure de l'exchange (`nonce()`). Sans bruit
    si l'exchange ne publie pas son heure. */
async function syncClock(ex: Exchange): Promise<void> {
  if (!ex.has["fetchTime"]) return;
  try {
    await ex.loadTimeDifference();
  } catch {
    /* on gardera la derniere mesure */
  }
}

type Ctor = new (config: Record<string, unknown>) => Exchange;

async function open(account: ExchangeAccount, market: Market): Promise<Exchange> {
  /* La classe suit le marche : KuCoin sert ses futures par une autre classe
     (memes cles, autre hote). Seuls les ids publies par ccxt : jamais une
     propriete quelconque de l'objet (`constructor`, `Exchange`…). */
  const id = ccxtIdFor(account.exchange, market);
  if (!ccxt.exchanges.includes(id)) throw Object.assign(new Error(`Exchange inconnu de ccxt : ${id}`), { name: "NotSupported" });
  const Klass = (ccxt as unknown as Record<string, Ctor>)[id];
  const ex = new Klass({
    apiKey: account.apiKey,
    secret: pemSecret(account.secret),
    ...(account.password ? { password: account.password } : {}),
    enableRateLimit: true,
    options: {
      defaultType: market === "futures" ? "swap" : "spot",
      /* L'horloge d'un PC derive de quelques secondes. Binance et Bybit
         exigent `timestamp < heure_serveur + 1 s` : une avance d'une
         seconde suffit a tout refuser (10002, -1021), et la fenetre n'y
         peut rien — seule la compensation compte. ccxt date alors les
         requetes a l'heure de l'exchange ; la fenetre couvre le reste. */
      adjustForTimeDifference: true,
      recvWindow: 10_000,
    },
  });
  if (account.testnet) ex.setSandboxMode(true);
  /* ⚠️ L'ECART D'HORLOGE AVANT `loadMarkets`. Bybit interroge le compte
     (`query-api`) AVANT que `fetchMarkets` ne mesure l'ecart : cet appel
     partait a l'heure du PC et tombait sur 10002. */
  await syncClock(ex);
  await ex.loadMarkets();
  return ex;
}
