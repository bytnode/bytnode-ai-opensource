import { randomUUID } from "node:crypto";
import type { ExchangeAccount } from "@/lib/domain/types";
import { EXPIRY_MS } from "../core/confirmations";
import { definePlugin, type Session } from "../core/contract";
import type { PaperService } from "../paper-trading/service";
import { PAPER_CASH } from "../shared/paper";
import { dcaCreateTool } from "./dca-create";
import { dcaListTool } from "./dca-list";
import { dcaPauseTool } from "./dca-pause";
import { dcaManifest } from "./manifest";
import { advance, changePlan, dueNow, editPlan, newPlan, readOrderOutcome, summarize, type DcaPlan, type PlanAction, type Purchase } from "./plans";
import { precheck } from "./precheck";
import { DEFAULT_GROUP, adoptLoose, addGroup, curveDays, groupNamed, movePlan, planCurve, renameGroup, seedGroups, type DcaGroup } from "./groups";
import { candles, isQuote, quotes } from "../shared/prices";
import type { Candle } from "../shared/candle";
import { APP_PASS } from "@/lib/bytnode/pass-id";

/* ---------------------------------------------------------------------------
   Recurring purchases.

   A job on the core's clock looks at the plans every minute. A due paper
   plan buys through the paper trading's service — when that plugin runs:
   off, the purchase is recorded as failed and said, the real plans go on.
   A due REAL plan is checked (market open, minimum, balance) and then only
   PROPOSED: `ctx.confirm` parks a PlaceOrder that runs after the user's
   click — the same prompt as in a conversation, LIVE / TESTNET badge, no
   "Always" — and `onConfirmed` records what happened. This plugin never
   places an order itself.

   Each purchase is recorded AS IT HAPPENS, plan by plan: one plan that
   breaks never loses what the others bought, and a proposal confirmed
   before the run ends is recorded as filled, not "proposed".
--------------------------------------------------------------------------- */

const PLANS = "plans.json";
const PURCHASES = "purchases.json";
const GROUPS = "groups.json";
const MAX_PURCHASES = 2000;
const PAPER_OFF = "Paper trading is off (Settings → Plugins): this paper plan cannot buy.";

type Handled = { purchase: Purchase; notice?: { title: string; body: string; level: "success" | "error" | "warning" } };

export const dcaPlugin = definePlugin({
  manifest: dcaManifest,
  setup(ctx) {
    /* Read at each use: the paper trading may be switched on or off. */
    const paper = () => ctx.optional<PaperService>("paper-trading");
    const plans = () => ctx.store.read<DcaPlan[]>(PLANS, []);
    const purchases = () => ctx.store.read<Purchase[]>(PURCHASES, []);
    const groups = () => ctx.store.read<DcaGroup[]>(GROUPS, []);
    /** A group ready the first time (the default one), and every DCA in a
       group: done before the state is read and before a DCA is made. */
    const settle = async () => {
      if ((await ctx.store.read<DcaGroup[] | null>(GROUPS, null)) === null) await ctx.store.update<DcaGroup[] | null>(GROUPS, null, (stored) => seedGroups(stored, randomUUID().slice(0, 8), new Date()));
      const [list, known] = await Promise.all([plans(), groups()]);
      const r = adoptLoose(list, known, randomUUID().slice(0, 8), new Date());
      if (!r.changed) return;
      await ctx.store.write(GROUPS, r.groups);
      await ctx.store.update<DcaPlan[]>(PLANS, [], (current) => adoptLoose(current, r.groups, "", new Date()).plans);
    };
    /** A group by name, made when there is none; no name: the first (the
       agents' tool, a DCA made without one). */
    const groupFor = async (name: string): Promise<DcaGroup | { error: string }> => {
      await settle();
      if (!name.trim()) {
        const first = (await groups())[0];
        if (first) return first;
        name = DEFAULT_GROUP;
      }
      const found = groupNamed(await groups(), name);
      if (found) return found;
      let result = { error: "" } as ReturnType<typeof addGroup>;
      await ctx.store.update<DcaGroup[]>(GROUPS, [], (list) => {
        result = addGroup(list, name, randomUUID().slice(0, 8), new Date());
        return "error" in result ? list : result.groups;
      });
      return "error" in result ? result : result.group;
    };
    /** Adds purchases; one already there (a proposal whose decision was
        recorded first, `onConfirmed`) is kept as it is. */
    const record = (list: Purchase[]) =>
      ctx.store.update<Purchase[]>(PURCHASES, [], (all) => {
        const known = new Set(all.map((p) => p.id));
        return [...all, ...list.filter((p) => !known.has(p.id))].slice(-MAX_PURCHASES);
      });
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
        const desk = paper();
        if (!desk) return { purchase: { ...base, mode: "paper", status: "failed", detail: PAPER_OFF }, notice: { title: `DCA (paper) not possible: ${plan.symbol}`, body: PAPER_OFF, level: "error" } };
        const r = await desk.buy({ symbol: plan.symbol, quoteAmount: plan.quoteAmount, note: `DCA ${plan.id}` }, { bytnodeKey: APP_PASS, accounts: session.exchangeAccounts, signal });
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
        /* What `onConfirmed` needs to write the purchase itself, should the
           user decide before this run records it. */
        payload: { planId: plan.id, due, purchaseId: base.id, mode, ...(late ? { late: true } : {}) },
      });
      return { purchase: { ...base, mode, status: "proposed", confirmationId: c.id } };
    };

    ctx.job({
      id: "due",
      title: "DCA purchases",
      every: "every 1 minute",
      async run({ session, signal }) {
        const now = new Date();
        /* A proposal nobody answered has expired with its confirmation. */
        const stale = (p: Purchase) => p.status === "proposed" && now.getTime() - Date.parse(p.at) > EXPIRY_MS;
        const known = await purchases();
        if (known.some(stale)) await ctx.store.update<Purchase[]>(PURCHASES, [], (all) => all.map((p) => (stale(p) ? { ...p, status: "expired", detail: "Not confirmed in time." } : p)));
        if (!(await plans()).some((plan) => dueNow(plan, now))) return "Nothing due.";
        /* A due date is CLAIMED (the plan moved to its next one) under the
           plans' lock before anything is bought: another run of this job —
           another process, a runtime left over by a reload — finds it gone.
           A due date is handled once, never twice. */
        const due: Array<{ plan: DcaPlan; due: string; late: boolean }> = [];
        await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => {
          due.length = 0;
          return list.map((plan) => {
            const d = dueNow(plan, now);
            if (!d) return plan;
            due.push({ plan, ...d });
            return advance(plan, now);
          });
        });
        if (due.length === 0) return "Nothing due.";
        const pending = known.filter((p) => p.status === "proposed" && !stale(p));
        const said: string[] = [];
        for (const d of due) {
          let h: Handled;
          try {
            h = await handle(d.plan, d.due, d.late, session, signal, pending);
          } catch (e) {
            /* One plan breaking never costs the others their records. */
            const detail = e instanceof Error ? e.message : String(e);
            h = {
              purchase: { id: randomUUID().slice(0, 12), planId: d.plan.id, due: d.due, at: new Date().toISOString(), mode: d.plan.destination === "paper" ? "paper" : "live", status: "failed", detail, ...(d.late ? { late: true } : {}) },
              notice: { title: `DCA purchase failed: ${d.plan.symbol}`, body: detail, level: "error" },
            };
          }
          await record([h.purchase]);
          if (h.notice) await ctx.notify({ ...h.notice, action: { kind: "open-view", view: "dca" } });
          said.push(`${h.purchase.planId}: ${h.purchase.status}`);
        }
        return said.join(", ");
      },
    });

    /* The user decided a proposal: what the exchange did is recorded. */
    /* ⚠️ The user may decide BEFORE the run has recorded the proposal (the
       notification shows at once; the next plan's exchange check takes
       seconds): the purchase is then written here, from the payload, and
       the run's later record keeps it as it is. */
    ctx.onConfirmed(async (c) => {
      const status: Purchase["status"] = c.status === "allowed" ? "filled" : c.status === "denied" ? "refused" : c.status === "expired" ? "expired" : "failed";
      const fill = c.status === "allowed" ? readOrderOutcome(c.outcome ?? "") : {};
      const decided = { status, ...fill, ...(c.outcome ? { detail: c.outcome } : {}) };
      const payload = (c.payload ?? {}) as { planId?: unknown; due?: unknown; purchaseId?: unknown; mode?: unknown; late?: unknown };
      await ctx.store.update<Purchase[]>(PURCHASES, [], (all) => {
        const mine = (p: Purchase) => p.confirmationId === c.id || (typeof payload.purchaseId === "string" && p.id === payload.purchaseId);
        if (all.some(mine)) return all.map((p) => (mine(p) ? { ...p, ...decided, confirmationId: c.id } : p));
        if (typeof payload.purchaseId !== "string" || typeof payload.planId !== "string") return all;
        const at = new Date().toISOString();
        const row: Purchase = { id: payload.purchaseId, planId: payload.planId, due: typeof payload.due === "string" ? payload.due : at, at, mode: payload.mode === "testnet" ? "testnet" : "live", confirmationId: c.id, ...(payload.late === true ? { late: true } : {}), ...decided };
        return [...all, row].slice(-MAX_PURCHASES);
      });
    });

    ctx.tool(dcaCreateTool(add, PAPER_CASH, groupFor, () => paper() !== undefined));
    ctx.tool(dcaListTool(async () => ({ plans: await plans(), purchases: await purchases(), groups: await groups() })));
    ctx.tool(dcaPauseTool(change));

    /* --- The view ---------------------------------------------------------- */

    ctx.api("state", async () => {
      /* The tab opens with a group ready ("My DCA"), made the first time;
         a DCA from before the groups is taken into the first. */
      await settle();
      const [list, all, known] = await Promise.all([plans(), purchases(), groups()]);
      return {
        plans: list.map((plan) => ({ ...plan, summary: summarize(all.filter((p) => p.planId === plan.id)) })),
        groups: known,
        purchases: all.slice(-300).reverse(),
        paperCash: PAPER_CASH,
        paperOn: paper() !== undefined,
      };
    });
    /* The current price of every pair the plans buy: what they are worth.
       Read apart from the state (BytNode's quota): once a minute. */
    ctx.api("prices", async (_params, { transport, signal }) => {
      const symbols = [...new Set((await plans()).map((p) => p.symbol))];
      const got = await quotes(symbols, { bytnodeKey: APP_PASS, accounts: transport.exchangeAccounts, signal });
      const prices: Record<string, number> = {};
      for (const s of symbols) {
        const q = got.get(s);
        if (q && isQuote(q)) prices[s] = q.price;
      }
      return { prices };
    });
    /* The value of a set of plans day by day, since its first purchase. */
    ctx.api("curve", async (params, { transport, signal }) => {
      const ids = new Set(Array.isArray(params.plans) ? params.plans.filter((x): x is string => typeof x === "string") : []);
      const chosen = (await plans()).filter((p) => ids.has(p.id));
      const bought = (await purchases()).filter((p) => ids.has(p.planId));
      const days = curveDays(bought, new Date());
      if (!days.length) return { series: [] };
      const closes: Record<string, Candle[]> = {};
      for (const symbol of [...new Set(chosen.map((p) => p.symbol))]) {
        const r = await candles(symbol, "1d", days.length + 1, { bytnodeKey: APP_PASS, accounts: transport.exchangeAccounts, signal });
        if ("candles" in r) closes[symbol] = r.candles;
      }
      return { series: planCurve(chosen, bought, closes, days) };
    });
    ctx.api("group", async (params) => {
      const action = params.action;
      const id = typeof params.id === "string" ? params.id : "";
      if (action === "delete") {
        let known = true;
        await ctx.store.update<DcaGroup[]>(GROUPS, [], (list) => {
          known = list.some((g) => g.id === id);
          return list.filter((g) => g.id !== id);
        });
        if (!known) throw new Error("No such group.");
        /* Its DCAs go with it: they stop (what they bought stays). */
        await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => list.filter((p) => p.groupId !== id));
        return { deleted: id };
      }
      let result = { error: "" } as ReturnType<typeof addGroup>;
      await ctx.store.update<DcaGroup[]>(GROUPS, [], (list) => {
        result = action === "rename" ? renameGroup(list, id, params.name) : action === "create" ? addGroup(list, params.name, randomUUID().slice(0, 8), new Date()) : { error: "Expected `action`: create, rename or delete." };
        return "error" in result ? list : result.groups;
      });
      if ("error" in result) throw new Error(result.error);
      return result.group;
    });
    ctx.api("move", async (params) => {
      const planId = typeof params.id === "string" ? params.id : "";
      const groupId = typeof params.groupId === "string" ? params.groupId : "";
      const known = await groups();
      let result = { error: "" } as ReturnType<typeof movePlan>;
      await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => {
        result = movePlan(list, known, planId, groupId);
        return "error" in result ? list : result.plans;
      });
      if ("error" in result) throw new Error(result.error);
      return result.plan;
    });
    ctx.api("create", async (params, { transport }) => {
      const accountId = typeof params.accountId === "string" && transport.exchangeAccounts.some((a) => a.id === params.accountId) ? params.accountId : undefined;
      /* Every DCA in a group: the one asked, else the first. */
      const asked = typeof params.groupId === "string" ? (await groups()).find((g) => g.id === params.groupId) : undefined;
      const home = asked ?? (await groupFor(""));
      if ("error" in home) throw new Error(home.error);
      const plan = newPlan({ ...params, accountId, groupId: home.id }, randomUUID().slice(0, 8), new Date());
      if ("error" in plan) throw new Error(plan.error);
      if (plan.destination === "paper" && plan.symbol.split("/")[1] !== PAPER_CASH) throw new Error(`The paper portfolio trades against ${PAPER_CASH}: use ${plan.symbol.split("/")[0]}/${PAPER_CASH}.`);
      if (plan.destination === "paper" && !paper()) throw new Error(PAPER_OFF);
      await add(plan);
      return plan;
    });
    ctx.api("edit", async (params) => {
      const id = typeof params.id === "string" ? params.id : "";
      const patch = { quoteAmount: params.quoteAmount, frequency: params.frequency, endAt: params.endAt, name: params.name, note: params.note };
      let result = { error: "" } as ReturnType<typeof editPlan>;
      await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => {
        result = editPlan(list, id, patch, new Date());
        return "error" in result ? list : result.plans;
      });
      if ("error" in result) throw new Error(result.error);
      /* A group asked too: moved there. */
      if (typeof params.groupId === "string" && params.groupId !== result.plan.groupId) {
        const known = await groups();
        let moved = { error: "" } as ReturnType<typeof movePlan>;
        await ctx.store.update<DcaPlan[]>(PLANS, [], (list) => {
          moved = movePlan(list, known, id, params.groupId as string);
          return "error" in moved ? list : moved.plans;
        });
        if ("error" in moved) throw new Error(moved.error);
        return moved.plan;
      }
      return result.plan;
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
