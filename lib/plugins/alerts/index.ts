import { randomUUID } from "node:crypto";
import type { CalendarService } from "../calendar/service";
import { definePlugin } from "../core/contract";
import type { SchedulerService } from "../scheduler/service";
import type { WatchlistService } from "../watchlist/service";
import { alertCreateTool } from "./alert-create";
import { alertDeleteTool } from "./alert-delete";
import { alertListTool } from "./alert-list";
import { WATCHLIST, newAlert, step, type Alert, type Trigger } from "./alerts";
import { evaluate, parseCondition, type AlertCondition } from "./conditions";
import { alertsManifest } from "./manifest";
import { readAll, type Sources } from "./read";

/* Alerts: the user's conditions on the market, checked by a scheduler job
   in one grouped reading, fired into the notification center once per
   crossing. The watchlist gives the assets of `watchlist` alerts; the
   calendar, when it runs, the events of `event<Nh`. */

const ALERTS = "alerts.json";
const TRIGGERS = "triggers.jsonl";
const MAX_TRIGGERS = 500;

export const alertsPlugin = definePlugin({
  manifest: alertsManifest,
  setup(ctx) {
    const scheduler = ctx.inject<SchedulerService>("scheduler");
    const watchlist = ctx.inject<WatchlistService>("watchlist");
    const calendar = () => ctx.optional<CalendarService>("calendar");
    const read = () => ctx.store.read<Alert[]>(ALERTS, []);
    /* A new alert is checked at once, not at the next tick. */
    const add = async (alert: Alert) => {
      await ctx.store.update<Alert[]>(ALERTS, [], (list) => [...list, alert]);
      await scheduler.trigger("check");
    };
    const remove = async (id: string) => {
      let removed: Alert[] = [];
      await ctx.store.update<Alert[]>(ALERTS, [], (list) => {
        removed = list.filter((a) => id === "all" || a.id === id);
        return list.filter((a) => !removed.includes(a));
      });
      return removed;
    };

    /** One check of every active alert. */
    const check = async (sources: Sources) => {
      const active = (await read()).filter((a) => a.status === "active");
      if (active.length === 0) return "No active alert.";
      const listed = active.some((a) => a.target === WATCHLIST) ? await watchlist.symbols() : [];
      const wants = active.flatMap((a) => (a.target === WATCHLIST ? listed : [a.target]).map((symbol) => ({ alertId: a.id, symbol, condition: parseCondition(a.condition) as AlertCondition, accountId: a.accountId })));
      const reading = await readAll(wants, sources, calendar());
      const now = new Date();
      const cooldown = Number(ctx.config().cooldownMinutes) * 60_000;
      const fired: Trigger[] = [];
      const failing: Array<{ alert: Alert; symbol: string; error: string }> = [];
      await ctx.store.update<Alert[]>(ALERTS, [], (list) =>
        list.map((alert) => {
          let a = alert;
          for (const w of wants.filter((x) => x.alertId === alert.id)) {
            const s = step(a, w.symbol, evaluate(w.condition, reading(w.symbol, a.accountId), now), now, cooldown);
            a = s.alert;
            if (s.trigger) fired.push({ id: randomUUID().slice(0, 12), ...s.trigger });
            if (s.failing) failing.push({ alert: a, symbol: w.symbol, error: s.failing });
          }
          return a;
        }),
      );
      for (const t of fired) {
        await ctx.store.append(TRIGGERS, t, MAX_TRIGGERS);
        await ctx.notify({ title: `Alert: ${t.symbol} ${t.condition}`, body: `${t.observed}${t.note ? ` — ${t.note}` : ""}`, level: "warning", action: { kind: "open-view", view: "alerts" } });
        ctx.emit("fired", t);
      }
      for (const f of failing) {
        await ctx.notify({ title: `Alert cannot be checked: ${f.symbol} ${f.alert.condition}`, body: f.error, level: "error", action: { kind: "open-view", view: "alerts" } });
      }
      return `${active.length} alert(s) checked, ${fired.length} fired${failing.length ? `, ${failing.length} cannot be checked` : ""}.`;
    };

    scheduler.job({ id: "check", title: "Alerts", every: String(ctx.config().every), run: ({ session, signal }) => check({ bytnodeKey: session.bytnodeKey, accounts: session.exchangeAccounts, signal }) });

    const hasCalendar = () => calendar() !== undefined;
    const listing = async () => ({ alerts: await read(), triggers: await ctx.store.lines<Trigger>(TRIGGERS) });
    ctx.tool(alertCreateTool(add, hasCalendar));
    ctx.tool(alertListTool(listing));
    ctx.tool(alertDeleteTool(remove));

    /* --- The view ---------------------------------------------------------- */

    ctx.api("state", async () => {
      const { alerts, triggers } = await listing();
      return { alerts, triggers: triggers.slice(-50).reverse(), calendar: hasCalendar() };
    });
    ctx.api("create", async (params, { transport }) => {
      const condition = parseCondition(String(params.condition ?? ""));
      if ("error" in condition) throw new Error(condition.error);
      if (condition.kind === "event" && !hasCalendar()) throw new Error("Event alerts need the market calendar: it is off (Settings → Plugins).");
      const accountId = typeof params.accountId === "string" && transport.exchangeAccounts.some((a) => a.id === params.accountId) ? params.accountId : undefined;
      const made = newAlert({ target: params.target, condition: params.condition, once: params.once, note: params.note, accountId }, randomUUID().slice(0, 8), new Date());
      if ("error" in made) throw new Error(made.error);
      await add(made.alert);
      return made.alert;
    });
    ctx.api("delete", async (params) => ({ removed: (await remove(String(params.id ?? ""))).length }));
  },
});
