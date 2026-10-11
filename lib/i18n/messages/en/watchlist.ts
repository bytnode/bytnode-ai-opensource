/* The Watchlist tab (`components/plugins/watchlist/`). */
export const watchlist = {
  title: "Watchlist",
  yourAssets: "Your assets",
  assets: "Assets",
  listWidth: "Width of the list",
  changeOver: "Change over",
  biggestFirst: "Biggest moves first",
  /* The windows a move is read over. */
  windows: { "1h": "1 h", "4h": "4 h", "24h": "24 h", "7d": "7 d" },
  noCandles: "No candles for this pair.",
  loadingChart: "Loading the chart…",
  needKey: "Assets come from BytNode: add your key in Settings → Auth.",
  listUnreadable: "BytNode's list of assets could not be read — try again in a moment.",
  noPrice: "No price",

  add: {
    label: "Add an asset",
    placeholder: "Add an asset — btc, Solana…",
    notFound: (query: string) => `Not found — BytNode does not cover “${query}”.`,
    options: "Assets to add",
    inList: "In your list",
  },

  menu: {
    label: (symbol: string) => `${symbol} actions`,
    show: (base: string) => `Show ${base}`,
    remove: "Remove from watchlist",
  },

  sheet: {
    line: "Line",
    candles: "Candles",
    live: (time: string) => `Live ${time}`,
    updated: (time: string) => `Updated ${time}`,
    noPriceYet: "No price yet",
    emptyTitle: "Nothing followed yet",
    emptyHint: "Add an asset on the left, or ask an agent: “add BTC and ETH to my watchlist”.",
    reading: "Reading your assets…",
    readAgain: "Read the prices again",
    removeLabel: (symbol: string) => `Remove ${symbol}`,
    removeTitle: "Remove from the watchlist",
    chartLabel: (symbol: string) => `${symbol} chart`,
    interval: "Interval",
    chartStyle: "Chart style",
    keyFigures: "Key figures",
    signals: "Signals",
    onCandles: (interval: string) => `on ${interval} candles`,
    pressure: "Pressure",
    pressureSub: "where the price may be pulled",
    comingUp: "Coming up",
    fromCalendar: "from the calendar",
    allAssets: "All assets",
    windowMove: (win: string) => `${win} move`,
    editNote: "Edit the note",
    addNote: "Add a note",
    noteLabel: (symbol: string) => `Note on ${symbol}`,
    notePlaceholder: "Why you follow it",
    source: (source: string, time: string, since: string) => `${source} · ${time} · following since ${since}`,
    noPairPrice: "No price for this pair",
  },

  /* Under the chart: the key figures. */
  insights: {
    range: "24 h range",
    rangeAt: (pct: string) => `Price at ${pct} of the day's range`,
    volume: "24 h volume",
    buyers: (share: string) => `${share} buyers`,
    sellers: "sellers",
    marketCap: "Market cap",
    fdv: (value: string) => `FDV ${value}`,
    circulating: (share: string) => `${share} in circulation`,
    funding: "Funding",
    /** `apr`, `next`: already written ("10.9 %", "16:00"), or null. */
    fundingSub: (apr: string | null, next: string | null) => `per 8 h${apr ? ` · APR ${apr}` : ""}${next ? ` · next ${next}` : ""}`,
    openInterest: "Open interest",
    long: (share: string) => `${share} long`,
    short: "short",
    liquidations: "24 h liquidations",
    longs: (value: string) => `Longs ${value}`,
    shorts: (value: string) => `Shorts ${value}`,
  },

  /* Under the key figures: the signals and the pressure. */
  signals: {
    zones: { oversold: "Oversold", neutral: "Neutral", overbought: "Overbought" },
    trends: { up: "Uptrend", down: "Downtrend", mixed: "Mixed" },
    trend: "Trend",
    volatility: "Volatility",
    volatilitySub: (interval: string) => `average range of a ${interval} bar (ATR 14)`,
    bullish: "Bullish",
    bearish: "Bearish",
    /** `more`: the count is a floor (30 bars or more). */
    macdSub: (bars: number, more: boolean) => `for ${bars} bar${bars > 1 ? "s" : ""}${more ? " or more" : ""} · 12 / 26 / 9`,
    pulls: { up: "Pulled up", down: "Pulled down", balanced: "Balanced" },
    clusters: "Liquidation clusters",
    above: (level: string) => `Above ${level}`,
    below: (level: string) => `Below ${level}`,
    orderBook: "Order book",
    bidsShare: (pct: string) => `Bids ${pct}`,
    asksShare: (pct: string) => `Asks ${pct}`,
    bids: "bids",
    asks: "asks",
    flow: "Flow · 5 min",
    buying: (pct: string) => `${pct} buying`,
    buyers: "buyers",
    sellers: "sellers",
  },

  /* What is coming for the asset, from the calendar. */
  coming: {
    nothing: (base: string, days: number) => `Nothing on the calendar for ${base} in the next ${days} days.`,
    openDay: "Open this day in the calendar",
    market: "Market",
    more: (n: number) => `${n} more in the calendar`,
  },

  /* The price chart (also drawn by the paper trading, the DCA and the portfolio). */
  chart: {
    label: "Price chart — scroll to zoom, drag to pan, double-click to come back to now",
    dailyReturns: "Daily returns",
  },
};
