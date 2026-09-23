import { randomUUID } from "node:crypto";
import type { ExchangeAccount } from "@/lib/domain/types";
import { EXPIRY_MS } from "../core/confirmations";
import { definePlugin, type Session } from "../core/contract";
import type { PaperService } from "../paper-trading/service";
import type { SchedulerService } from "../scheduler/service";
import { dcaCreateTool } from "./dca-create";
import { dcaListTool } from "./dca-list";
import { dcaPauseTool } from "./dca-pause";
import { dcaManifest } from "./manifest";
import { advance, changePlan, dueNow, newPlan, readOrderOutcome, summarize, type DcaPlan, type PlanAction, type Purchase } from "./plans";
import { precheck } from "./precheck";

/* ---------------------------------------------------------------------------
   Recurring purchases.

   A scheduler job looks at the plans every minute. A due paper plan buys
   through the paper trading's service. A due REAL plan is checked (market
   open, minimum, balance) and then only PROPOSED: `ctx.confirm` parks a
   PlaceOrder that runs after the user's click — the same prompt as in a
   conversation, LIVE / TESTNET badge, no "Always" — and `onConfirmed`
   records what happened. This plugin never places an order itself.
--------------------------------------------------------------------------- */

const PLANS = "plans.json";
const PURCHASES = "purchases.json";
const MAX_PURCHASES = 2000;

type Handled = { purchase: Purchase; notice?: { title: string; body: string; level: "success" | "error" | "warning" } };

export const dcaPlugin = definePlugin({
  manifest: dcaManifest,
  setup(ctx) {
    const scheduler = ctx.inject<SchedulerService>("scheduler");
    const paper = ctx.inject<PaperService>("paper-trading");
    const plans = () => ctx.store.read<DcaPlan[]>(PLANS, []);
    const purchases = () => ctx.store.read<Purchase[]>(PURCHASES, []);
    const record = (list: Purchase[]) => ctx.store.update<Purchase[]>(PURCHASES, [], (all) => [...all, ...list].slice(-MAX_PURCHASES));
    const add = async (plan: DcaPlan) => void (await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => [...list, plan]));
    const change = async (id: string, action: PlanAction) => {
      let result = { error: "" } as ReturnType<typeof changePlan>;
      await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => {
        result = changePlan(list, id, action, new Date());
        return "error" in result ? list : result.plans;
      });
      return result;
    };

    /** One due date of one plan. */
    const handle = async (plan: DcaPlan, due: string, late: boolean, session: Session, signal: AbortSignal, pending: Purchase[]): Promise<Handled> => {
      const base = { id: randomUUID().slice(0, 12), planId: plan.id, due, at: new Date().toISOString(), ...(late ? { late: true } : {}) };
      const [asset, quote] = plan.symbol.split("/");
      if (plan.destination === "paper") {
        const r = await paper.buy({ symbol: plan.symbol, quoteAmount: plan.quoteAmount, note: `DCA ${plan.id}` }, { bytnodeKey: session.bytnodeKey, accounts: session.exchangeAccounts, signal });
        if ("error" in r || !r.fill) {
          const detail = "error" in r ? r.error : "The paper order did not fill.";
          return { purchase: { ...base, mode: "paper", status: "failed", detail }, notice: { title: `DCA (paper) failed: ${plan.symbol}`, body: detail, level: "error" } };
        }
        return { purchase: { ...base, mode: "paper", status: "filled", amount: r.fill.amount, price: r.fill.price, fee: r.fill.fee } };
      }
      const account = session.exchangeAccounts.find((a: ExchangeAccount) => a.id === plan.accountId);
      if (!account) {
        const detail = "The exchange account of this plan is no longer configured.";
        return { purchase: { ...base, mode: "live", status: "failed", detail }, notice: { title: `DCA purchase not possible: ${plan.symbol}`, body: detail, level: "error" } };
      }
      const mode = account.testnet ? "testnet" : "live";
      /* One proposal at a time: the user has not answered the last one. */
      if (pending.some((p) => p.planId === plan.id)) return { purchase: { ...base, mode, status: "skipped", detail: "The previous purchase still awaits your confirmation." } };
      const checked = await precheck(account, plan.symbol, plan.quoteAmount);
      if ("error" in checked) return { purchase: { ...base, mode, status: "failed", detail: checked.error }, notice: { title: `DCA purchase not possible: ${plan.symbol}`, body: checked.error, level: "error" } };
      const c = await ctx.confirm({
        tool: "PlaceOrder",
        args: { symbol: plan.symbol, side: "buy", type: "market", quoteAmount: plan.quoteAmount, market: "spot" },
        accountId: account.id,
        title: `DCA purchase ready: ${plan.quoteAmount} ${quote} of ${asset}`,
        reason: `${late ? `Due ${due.slice(0, 16).replace("T", " ")} UTC, missed while the app was closed. ` : ""}Plan ${plan.id} (${plan.frequency}): market buy of ${plan.quoteAmount} ${quote} of ${asset} on ${account.label} (${account.testnet ? "TESTNET" : "LIVE"}), about ${Number((plan.quoteAmount / checked.price).toPrecision(6))} ${asset} at ${checked.price}. Nothing is bought until you confirm.`,
        payload: { planId: plan.id, due },
      });
      return { purchase: { ...base, mode, status: "proposed", confirmationId: c.id } };
    };

    scheduler.job({
      id: "due",
      title: "DCA purchases",
      every: "every 1 minute",
      async run({ session, signal }) {
        const now = new Date();
        /* A proposal nobody answered has expired with its confirmation. */
        const stale = (p: Purchase) => p.status === "proposed" && now.getTime() - Date.parse(p.at) > EXPIRY_MS;
        const known = await purchases();
        if (known.some(stale)) await ctx.store.update<Purchase[]>(PURCHASES, [], (all) => all.map((p) => (stale(p) ? { ...p, status: "expired", detail: "Not confirmed in time." } : p)));
        const due = (await plans()).map((plan) => ({ plan, d: dueNow(plan, now) })).filter((x) => x.d !== null);
        if (due.length === 0) return "Nothing due.";
        const pending = known.filter((p) => p.status === "proposed" && !stale(p));
        const handled: Handled[] = [];
        for (const { plan, d } of due) handled.push(await handle(plan, d!.due, d!.late, session, signal, pending));
        await record(handled.map((h) => h.purchase));
        const ids = new Set(due.map((x) => x.plan.id));
        await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => list.map((p) => (ids.has(p.id) && p.status === "active" ? advance(p, now) : p)));
        for (const h of handled) if (h.notice) await ctx.notify({ ...h.notice, action: { kind: "open-view", view: "dca" } });
        return handled.map((h) => `${h.purchase.planId}: ${h.purchase.status}`).join(", ");
      },
    });

    /* The user decided a proposal: what the exchange did is recorded. */
    ctx.onConfirmed(async (c) => {
      const status: Purchase["status"] = c.status === "allowed" ? "filled" : c.status === "denied" ? "refused" : c.status === "expired" ? "expired" : "failed";
      const fill = c.status === "allowed" ? readOrderOutcome(c.outcome ?? "") : {};
      await ctx.store.update<Purchase[]>(PURCHASES, [], (all) => all.map((p) => (p.confirmationId === c.id ? { ...p, status, ...fill, ...(c.outcome ? { detail: c.outcome } : {}) } : p)));
    });

    ctx.tool(dcaCreateTool(add, paper.cash));
    ctx.tool(dcaListTool(async () => ({ plans: await plans(), purchases: await purchases() })));
    ctx.tool(dcaPauseTool(change));

    /* --- The view ---------------------------------------------------------- */

    ctx.api("state", async () => {
      const [list, all] = await Promise.all([plans(), purchases()]);
      return {
        plans: list.map((plan) => ({ ...plan, summary: summarize(all.filter((p) => p.planId === plan.id)) })),
        purchases: all.slice(-100).reverse(),
        paperCash: paper.cash,
      };
    });
    ctx.api("create", async (params, { transport }) => {
      const accountId = typeof params.accountId === "string" && transport.exchangeAccounts.some((a) => a.id === params.accountId) ? params.accountId : undefined;
      const plan = newPlan({ ...params, accountId }, randomUUID().slice(0, 8), new Date());
      if ("error" in plan) throw new Error(plan.error);
      if (plan.destination === "paper" && plan.symbol.split("/")[1] !== paper.cash) throw new Error(`The paper portfolio trades against ${paper.cash}: use ${plan.symbol.split("/")[0]}/${paper.cash}.`);
      await add(plan);
      return plan;
    });
    ctx.api("update", async (params) => {
      const action = (["pause", "resume", "delete"] as const).find((a) => a === params.action);
      if (!action || typeof params.id !== "string") throw new Error("Expected `id` and `action` (pause, resume, delete).");
      const r = await change(params.id, action);
      if ("error" in r) throw new Error(r.error);
      return r.plan;
    });
  },
});
