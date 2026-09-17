/* ---------------------------------------------------------------------------
   Les exchanges proposes a l'utilisateur : les dix plus gros, par leur id
   ccxt, avec ce que chacun permet VRAIMENT — releve sur ccxt 4.5 (`has`,
   `urls.test`, comptes de transfert) et sur la doc de chaque exchange.

   Ces limites sont des faits, pas des choix : un compte unifie n'a qu'un
   solde (rien a transferer), MEXC a ferme le passage d'ordres futures par
   API, Kraken Futures a ses propres cles. Les outils les lisent pour
   refuser proprement, avant tout appel, avec la raison. Pur, partage
   navigateur / serveur.
--------------------------------------------------------------------------- */

export type ExchangeInfo = {
  id: string;
  label: string;
  /** ccxt sait basculer ce compte sur le reseau de test (`setSandboxMode`). */
  testnet: boolean;
  /** L'exchange exige une passphrase en plus de la cle et du secret. */
  password: boolean;
  /** Perpetuels lineaires USDT : `full` (lecture et ordres), `read` (lecture
      seule), `none` (spot seulement). */
  futures: "full" | "read" | "none";
  /** La classe ccxt des futures quand ce n'est pas la meme que le spot
      (KuCoin) — memes cles, autre hote. */
  futuresId?: string;
  /** Transfert interne spot ↔ futures possible par l'API. */
  transfer: boolean;
  /** Le portefeuille ou arrivent les depots quand ce n'est PAS le compte de
      trading (nom ccxt) : Bybit et OKX « funding », KuCoin « main », Binance
      « funding » (P2P, Pay). Absent : les depots vont au spot. */
  funding?: string;
  /** Le compte de trading vu par ccxt pour un transfert depuis le Funding,
      quand ce n'est pas simplement « spot » (Bybit : « unified »). */
  tradingWallet?: string;
  /** Ce que l'utilisateur et l'agent doivent savoir, en une phrase. */
  note?: string;
};

export const EXCHANGES: ExchangeInfo[] = [
  {
    id: "binance",
    label: "Binance",
    testnet: true,
    password: false,
    futures: "full",
    transfer: true,
    funding: "funding",
    note: "Testnet : les clés spot (testnet.binance.vision) et futures (testnet.binancefuture.com) sont distinctes — un compte testnet ne sert qu'un des deux marchés.",
  },
  {
    id: "bybit",
    label: "Bybit",
    testnet: true,
    password: false,
    futures: "full",
    transfer: false,
    funding: "funding",
    tradingWallet: "unified",
    note: "Compte unifié : spot et futures partagent le même solde. Les dépôts arrivent dans le portefeuille Funding, à transférer vers le compte unifié pour trader. Testnet : clés créées sur testnet.bybit.com.",
  },
  {
    id: "okx",
    label: "OKX",
    testnet: true,
    password: true,
    futures: "full",
    transfer: false,
    funding: "funding",
    note: "Compte de trading unifié : spot et futures partagent le même solde ; les dépôts arrivent dans le compte Funding, à transférer vers le trading. Testnet = démo OKX, avec des clés API créées en mode démo.",
  },
  {
    id: "coinbase",
    label: "Coinbase",
    testnet: false,
    password: false,
    futures: "none",
    transfer: false,
    note: "Advanced Trade, marchés au comptant. Clé CDP : le secret est la clé privée EC (bloc « -----BEGIN … ----- »), à coller telle quelle.",
  },
  {
    id: "kraken",
    label: "Kraken",
    testnet: false,
    password: false,
    futures: "none",
    transfer: false,
    note: "Kraken Futures a ses propres clés (futures.kraken.com), hors de cette intégration.",
  },
  {
    id: "bitget",
    label: "Bitget",
    testnet: false,
    password: true,
    futures: "full",
    transfer: true,
    note: "Futures : le compte doit être en one-way (Bitget démarre en hedge mode) — vérifié avant chaque ordre.",
  },
  {
    id: "kucoin",
    label: "KuCoin",
    testnet: false,
    password: true,
    futures: "full",
    futuresId: "kucoinfutures",
    transfer: true,
    funding: "main",
    note: "Une même clé, avec les permissions Spot et Futures, sert les deux marchés. Les dépôts arrivent sur le compte principal (main), à transférer vers le compte de trading.",
  },
  {
    id: "gate",
    label: "Gate.io",
    testnet: true,
    password: false,
    futures: "full",
    transfer: true,
    note: "Testnet : clés créées sur testnet.gate.com. Le mode de marge ne se règle pas par l'API (levier seulement).",
  },
  {
    id: "htx",
    label: "HTX",
    testnet: false,
    password: false,
    futures: "full",
    transfer: false,
    note: "Pas de transfert spot ↔ futures USDT ni de mode de marge par cette intégration : à faire sur l'exchange.",
  },
  {
    id: "mexc",
    label: "MEXC",
    testnet: false,
    password: false,
    futures: "read",
    transfer: true,
    note: "Futures en lecture seule : MEXC a fermé le passage et l'annulation d'ordres futures par API (depuis le 25/07/2022). Le spot est complet.",
  },
];

export const exchangeInfo = (id: string): ExchangeInfo | undefined => EXCHANGES.find((e) => e.id === id);

/** La classe ccxt a instancier pour ce marche. */
export const ccxtIdFor = (exchange: string, market: "spot" | "futures"): string =>
  (market === "futures" && exchangeInfo(exchange)?.futuresId) || exchange;
