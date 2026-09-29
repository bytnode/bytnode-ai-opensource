// BTC rebalance: reads a granted account, and PROPOSES the order — the user
// confirms it (ctx.confirm); onConfirmed records what happened.

async function state(ctx, account) {
  const accounts = await ctx.exchange.accounts();
  const chosen = account ? accounts.find((a) => a.id === account || a.label === account) : accounts[0];
  if (!chosen) throw new Error("No exchange account was granted to this plugin.");
  const { balances } = await ctx.exchange.balance(chosen.id, "spot");
  const t = await ctx.exchange.ticker(chosen.id, "BTC/USDT", "spot");
  const btc = balances.BTC ? balances.BTC.total : 0;
  const usdt = balances.USDT ? balances.USDT.total : 0;
  const total = btc * t.last + usdt;
  const share = total > 0 ? ((btc * t.last) / total) * 100 : 0;
  const target = ctx.config().target;
  return { account: chosen, price: t.last, btc, usdt, total, share, target, drift: share - target };
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export default {
  setup(ctx) {
    const accountProp = { type: "string", description: "The account (label or id). Optional when only one is granted." };

    ctx.tool({
      name: "RebalanceCheck",
      description: "Reads the share of BTC in the user's account against their target, and says whether a rebalance is due.",
      parameters: { type: "object", properties: { account: accountProp }, additionalProperties: false },
      readOnly: true,
      run: async ({ account }) => {
        const s = await state(ctx, account);
        const due = Math.abs(s.drift) >= ctx.config().band;
        return {
          text: `${s.account.label}${s.account.testnet ? " (testnet)" : " (LIVE)"}: BTC is ${round(s.share, 1)} % of ${round(s.total)} USDT, target ${s.target} %. ${due ? "A rebalance is due." : "Within the band."}`,
          facts: { title: `Rebalance · ${s.account.label}`, rows: [["BTC share", `${round(s.share, 1)} %`], ["Target", `${s.target} %`], ["Value", `${round(s.total)} USDT`]] },
        };
      },
    });

    ctx.tool({
      name: "RebalancePropose",
      description: "Proposes to the user the market order that brings BTC back to their target share. The order runs only if the user confirms it.",
      parameters: { type: "object", properties: { account: accountProp }, additionalProperties: false },
      readOnly: false,
      run: async ({ account }) => {
        const s = await state(ctx, account);
        if (Math.abs(s.drift) < ctx.config().band) return `Nothing to propose: BTC is ${round(s.share, 1)} %, within the band around ${s.target} %.`;
        const usdt = round((Math.abs(s.drift) / 100) * s.total);
        const side = s.drift < 0 ? "buy" : "sell";
        const c = await ctx.confirm({
          tool: "PlaceOrder",
          account: s.account.id,
          args: side === "buy" ? { symbol: "BTC/USDT", side, type: "market", quoteAmount: usdt } : { symbol: "BTC/USDT", side, type: "market", amount: round(usdt / s.price, 6) },
          title: `Rebalance: ${side} ${usdt} USDT of BTC`,
          reason: `BTC is ${round(s.share, 1)} % of the account, the target is ${s.target} %.`,
          payload: { share: round(s.share, 1) },
        });
        await ctx.store.append("proposals", { id: c.id, side, usdt, at: new Date().toISOString(), status: "pending" }, 200);
        return `Proposed to the user: ${side} ${usdt} USDT of BTC. It waits for their confirmation in the notifications.`;
      },
    });

    ctx.onConfirmed(async (c) => {
      await ctx.store.append("decisions", { id: c.id, status: c.status, outcome: c.outcome, at: new Date().toISOString() }, 200);
    });
  },
};
