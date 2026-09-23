/* ---------------------------------------------------------------------------
   The exchanges offered to the user: the ten largest, by their ccxt id,
   with what each one REALLY allows — measured on ccxt 4.5 (`has`,
   `urls.test`, transfer accounts) and on each exchange's docs.

   These limits are facts, not choices: a unified account has a single
   balance (nothing to transfer), MEXC closed futures order placement by
   API, Kraken Futures has its own keys. The tools read them to refuse
   cleanly, before any call, with the reason. Pure, shared browser /
   server.
--------------------------------------------------------------------------- */

export type ExchangeInfo = {
  id: string;
  label: string;
  /** ccxt can switch this account to the test network (`setSandboxMode`). */
  testnet: boolean;
  /** The exchange requires a passphrase in addition to the key and secret. */
  password: boolean;
  /** Linear USDT perpetuals: `full` (read and orders), `read` (read-only),
      `none` (spot only). */
  futures: "full" | "read" | "none";
  /** The ccxt class for futures when it is not the same as spot (KuCoin)
      — same keys, other host. */
  futuresId?: string;
  /** Internal spot ↔ futures transfer possible through the API. */
  transfer: boolean;
  /** One balance for spot and futures (unified account): reading both
      markets would count it twice. */
  unified?: boolean;
  /** The wallet where deposits land when it is NOT the trading account
      (ccxt name): Bybit and OKX "funding", KuCoin "main", Binance "funding"
      (P2P, Pay). Absent: deposits go to spot. */
  funding?: string;
  /** The trading account as ccxt sees it for a transfer from Funding, when
      it is not simply "spot" (Bybit: "unified"). */
  tradingWallet?: string;
  /** The maintenance margin rate of the first tier of the BTC/USDT
      perpetual, as a fraction: the position calculator's default when the
      user gives none. Larger positions and other pairs use higher tiers. */
  maintenanceMargin?: number;
  /** What the user and the agent need to know, in one sentence. */
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
    maintenanceMargin: 0.004,
    note: "Testnet: spot keys (testnet.binance.vision) and futures keys (testnet.binancefuture.com) are distinct — a testnet account serves only one of the two markets.",
  },
  {
    id: "bybit",
    label: "Bybit",
    testnet: true,
    password: false,
    futures: "full",
    transfer: false,
    unified: true,
    funding: "funding",
    tradingWallet: "unified",
    maintenanceMargin: 0.005,
    note: "Unified account: spot and futures share the same balance. Deposits land in the Funding wallet, to be transferred to the unified account before trading. Testnet: keys created on testnet.bybit.com.",
  },
  {
    id: "okx",
    label: "OKX",
    testnet: true,
    password: true,
    futures: "full",
    transfer: false,
    unified: true,
    funding: "funding",
    maintenanceMargin: 0.004,
    note: "Unified trading account: spot and futures share the same balance; deposits land in the Funding account, to be transferred to trading. Testnet = OKX demo, with API keys created in demo mode.",
  },
  {
    id: "coinbase",
    label: "Coinbase",
    testnet: false,
    password: false,
    futures: "none",
    transfer: false,
    note: "Advanced Trade, spot markets. CDP key: the secret is the EC private key (the \"-----BEGIN … -----\" block), to paste as is.",
  },
  {
    id: "kraken",
    label: "Kraken",
    testnet: false,
    password: false,
    futures: "none",
    transfer: false,
    note: "Kraken Futures has its own keys (futures.kraken.com), outside this integration.",
  },
  {
    id: "bitget",
    label: "Bitget",
    testnet: false,
    password: true,
    futures: "full",
    transfer: true,
    maintenanceMargin: 0.004,
    note: "Futures: the account must be in one-way mode (Bitget starts in hedge mode) — checked before every order.",
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
    maintenanceMargin: 0.004,
    note: "A single key, with the Spot and Futures permissions, serves both markets. Deposits land on the main account, to be transferred to the trading account.",
  },
  {
    id: "gate",
    label: "Gate.io",
    testnet: true,
    password: false,
    futures: "full",
    transfer: true,
    maintenanceMargin: 0.005,
    note: "Testnet: keys created on testnet.gate.com. The margin mode cannot be set through the API (leverage only).",
  },
  {
    id: "htx",
    label: "HTX",
    testnet: false,
    password: false,
    futures: "full",
    transfer: false,
    maintenanceMargin: 0.005,
    note: "No spot ↔ USDT futures transfer nor margin mode through this integration: do it on the exchange.",
  },
  {
    id: "mexc",
    label: "MEXC",
    testnet: false,
    password: false,
    futures: "read",
    transfer: true,
    maintenanceMargin: 0.004,
    note: "Futures read-only: MEXC closed futures order placement and cancellation by API (since 2022-07-25). Spot is complete.",
  },
];

export const exchangeInfo = (id: string): ExchangeInfo | undefined => EXCHANGES.find((e) => e.id === id);

/** The ccxt class to instantiate for this market. */
export const ccxtIdFor = (exchange: string, market: "spot" | "futures"): string =>
  (market === "futures" && exchangeInfo(exchange)?.futuresId) || exchange;
