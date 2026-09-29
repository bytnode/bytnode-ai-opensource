// Fear & Greed: an outside API (declared host only), a tool for the agents,
// an action for the tab, and a small cache in the plugin's store.

const API = "https://api.alternative.me/fng/?limit=30";
const CACHE_MS = 30 * 60 * 1000;

async function history(ctx) {
  const cached = await ctx.store.get("history", null);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.days;
  const r = await ctx.fetch(API);
  if (!r.ok) throw new Error(`alternative.me answered ${r.status}: try again in a minute.`);
  const days = r
    .json()
    .data.map((d) => ({ date: new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10), value: Number(d.value), label: d.value_classification }))
    .reverse();
  await ctx.store.set("history", { at: Date.now(), days });
  return days;
}

export default {
  setup(ctx) {
    ctx.tool({
      name: "FearGreedIndex",
      description: "Gives the crypto Fear & Greed index today (0 = extreme fear, 100 = extreme greed) and its change over the last 30 days. Use it when the user asks about the market's mood or sentiment.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      readOnly: true,
      run: async () => {
        const days = await history(ctx);
        if (!days.length) return { error: "alternative.me returned no value." };
        const today = days[days.length - 1];
        const first = days[0];
        return {
          text: `Fear & Greed today: ${today.value} (${today.label}), ${first.value} thirty days ago. Source: alternative.me.`,
          facts: { title: "Fear & Greed", rows: [["Today", `${today.value} · ${today.label}`], ["30 days ago", String(first.value)], ["Lowest", String(Math.min(...days.map((d) => d.value)))]] },
        };
      },
    });

    ctx.action("history", async () => history(ctx));
  },
};
