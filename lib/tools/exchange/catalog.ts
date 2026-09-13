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
