// Price watch: tools to add and list, a job every 15 minutes, a notification
// when an asset moved more than the threshold since the last warning.

const FILE = "watched";

const move = (price, reference) => ((price - reference) / reference) * 100;
const pct = (n) => (n > 0 ? "+" : "") + n.toFixed(2) + " %";

export default {
  setup(ctx) {
    ctx.tool({
      name: "PriceWatchAdd",
      description: "Starts watching an asset's price for the user: they are notified when it moves more than their threshold. Give the pair as BTC/USDT.",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "The pair, BTC/USDT." } },
        required: ["symbol"],
        additionalProperties: false,
      },
      readOnly: false,
      run: async ({ symbol }) => {
        const pair = String(symbol).toUpperCase();
        const q = await ctx.price(pair);
        await ctx.store.update(FILE, [], (list) => [...list.filter((w) => w.symbol !== pair), { symbol: pair, reference: q.price, at: q.at }]);
        return `Watching ${pair} from ${q.price}. The user is warned beyond ±${ctx.config().threshold} %.`;
      },
    });

    ctx.tool({
      name: "PriceWatchList",
      description: "Lists the assets the user watches, with their move since the last warning.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      readOnly: true,
      run: async () => {
        const list = await ctx.store.get(FILE, []);
        if (!list.length) return "The user watches no asset yet.";
        const rows = [];
        for (const w of list) {
          const q = await ctx.price(w.symbol);
          rows.push([w.symbol, String(q.price), pct(move(q.price, w.reference))]);
        }
        return {
          text: rows.map((r) => `${r[0]} ${r[1]} (${r[2]} since the reference)`).join("\n"),
          table: { title: "Watched prices", columns: ["Pair", "Price", "Move"], rows },
        };
      },
    });

    ctx.job({
      id: "check",
      title: "Check the watched prices",
      every: "every 15 minutes",
      run: async () => {
        const threshold = ctx.config().threshold;
        const list = await ctx.store.get(FILE, []);
        let warned = 0;
        for (const w of list) {
          const q = await ctx.price(w.symbol);
          const m = move(q.price, w.reference);
          if (Math.abs(m) < threshold) continue;
          warned++;
          await ctx.notify({ title: `${w.symbol} ${pct(m)}`, body: `It is at ${q.price}, from ${w.reference} at the last warning.`, level: m > 0 ? "success" : "warning" });
          await ctx.store.update(FILE, [], (all) => all.map((x) => (x.symbol === w.symbol ? { ...x, reference: q.price, at: q.at } : x)));
        }
        return `${list.length} checked, ${warned} warned`;
      },
    });

    ctx.prompt(async () => {
      const list = await ctx.store.get(FILE, []);
      return list.length ? `The user watches ${list.map((w) => w.symbol).join(", ")} (warned beyond ±${ctx.config().threshold} %).` : "";
    });
  },
};
