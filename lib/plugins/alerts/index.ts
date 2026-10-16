import { randomUUID } from "node:crypto";
import type { CalendarService } from "../calendar/service";
import { definePlugin } from "../core/contract";
import type { WatchlistService } from "../watchlist/service";
import { alertCreateTool } from "./alert-create";
import { alertDeleteTool } from "./alert-delete";
import { alertListTool } from "./alert-list";
import { WATCHLIST, alertLabel, newAlert, step, type Alert, type Trigger, alertTelegramText } from "./alerts";
import { sendToBot } from "../shared/telegram";
import type { Session } from "../core/contract";
import { currentValue, evaluate, onPosition, parseCondition, type AlertCondition } from "./conditions";
import { bytnodePairs } from "../shared/prices";
import { normalizeSymbol } from "../shared/quote";
import { alertsManifest } from "./manifest";
import { readAll, type Sources } from "./read";
import { APP_PASS } from "@/lib/bytnode/pass-id";

/* Alerts: the user's conditions on the market, checked by a job on the
   core's clock in one grouped reading, fired into the notification center
   once per crossing. Two plugins are used when they run, never needed:
   the watchlist gives the assets of `watchlist` alerts (off: such an alert
   says it cannot be checked), the calendar the events of `event<Nh`. */

const WATCHLIST_OFF = "The watchlist is off (Settings → Plugins): this alert has no assets to check.";

const ALERTS = "alerts.json";
const TRIGGERS = "triggers.jsonl";
const MAX_TRIGGERS = 500;

export const alertsPlugin = definePlugin({
  manifest: alertsManifest,
  setup(ctx) {
    const watchlist = () => ctx.optional<WatchlistService>("watchlist");
    const calendar = () => ctx.optional<CalendarService>("calendar");
    const read = () => ctx.store.read<Alert[]>(ALERTS, []);
    /* A new alert is checked at once, not at the next tick. */
    const add = async (alert: Alert) => {
      await ctx.store.update<Alert[]>(ALERTS, [], (list) => [...list, alert]);
      await ctx.trigger("check");
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
    const check = async (sources: Sources, session: Session | null = null) => {
      const active = (await read()).filter((a) => a.status === "active");
      if (active.length === 0) return "No active alert.";
      const list = watchlist();
      const listed = list && active.some((a) => a.target === WATCHLIST) ? await list.symbols() : [];
      const wants = active.flatMap((a) => (a.target === WATCHLIST ? listed : [a.target]).map((symbol) => ({ alertId: a.id, symbol, condition: parseCondition(a.condition) as AlertCondition, accountId: a.accountId })));
      const reading = await readAll(wants, sources, calendar());
      const now = new Date();
      const cooldown = Number(ctx.config().cooldownMinutes) * 60_000;
      const fired: Trigger[] = [];
      const failing: Array<{ alert: Alert; symbol: string; error: string }> = [];
      await ctx.store.update<Alert[]>(ALERTS, [], (list) =>
        list.map((alert) => {
          let a = alert;
          if (!list && alert.status === "active" && alert.target === WATCHLIST) {
            const s = step(a, WATCHLIST, { error: WATCHLIST_OFF }, now, cooldown);
            a = s.alert;
            if (s.failing) failing.push({ alert: a, symbol: WATCHLIST, error: s.failing });
          }
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
        await ctx.notify({ title: `${t.symbol}: ${alertLabel(t.condition)}`, body: `${t.observed}${t.note ? ` — ${t.note}` : ""}`, level: "warning", action: { kind: "open-view", view: "alerts" } });
        /* Also to the alert's Telegram bot, when it has one. */
        const bot = active.find((a) => a.id === t.alertId)?.telegramBot;
        if (bot) {
          const sent = await sendToBot(session, bot, alertTelegramText(t));
          if (sent.error) await ctx.notify({ title: `Not sent to Telegram: ${t.symbol}`, body: sent.error, level: "warning", action: { kind: "open-view", view: "alerts" } });
        }
        ctx.emit("fired", t);
      }
      for (const f of failing) {
        await ctx.notify({ title: `Alert cannot be checked: ${f.symbol}, ${alertLabel(f.alert.condition)}`, body: f.error, level: "error", action: { kind: "open-view", view: "alerts" } });
      }
      return `${active.length} alert(s) checked, ${fired.length} fired${failing.length ? `, ${failing.length} cannot be checked` : ""}.`;
    };

    ctx.job({ id: "check", title: "Alerts", every: String(ctx.config().every), run: ({ session, signal }) => check({ bytnodeKey: APP_PASS, accounts: session.exchangeAccounts, signal }, session) });

    const hasCalendar = () => calendar() !== undefined;
    const listing = async () => ({ alerts: await read(), triggers: await ctx.store.lines<Trigger>(TRIGGERS) });
    ctx.tool(alertCreateTool(add, hasCalendar, () => watchlist() !== undefined, () => ctx.session()?.telegramBots));
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
      const made = newAlert({ target: params.target, condition: params.condition, once: params.once, note: params.note, accountId, telegramBot: params.telegramBot }, randomUUID().slice(0, 8), new Date());
      if ("error" in made) throw new Error(made.error);
      if (made.alert.target === WATCHLIST && !watchlist()) throw new Error(WATCHLIST_OFF);
      await add(made.alert);
      return made.alert;
    });
    ctx.api("delete", async (params) => ({ removed: (await remove(String(params.id ?? ""))).length }));
    /* The alert's Telegram bot, by id; `bot: ""` for none. */
    ctx.api("telegram", async (params) => {
      const bot = typeof params.bot === "string" ? params.bot.trim() : "";
      let found = false;
      await ctx.store.update<Alert[]>(ALERTS, [], (list) =>
        list.map((a) => {
          if (a.id !== params.id) return a;
          found = true;
          const { telegramBot: _old, ...rest } = a;
          void _old;
          return bot ? { ...rest, telegramBot: bot } : rest;
        }),
      );
      if (!found) throw new Error("No such alert.");
      return { bot };
    });
    /* Pause stops the checks; resume starts again from what holds now. */
    ctx.api("pause", async (params) => {
      const paused = params.paused === true;
      let found = false;
      await ctx.store.update<Alert[]>(ALERTS, [], (list) =>
        list.map((a) => {
          if (a.id !== params.id || a.status === "done") return a;
          found = true;
          return { ...a, status: paused ? "paused" : "active", ...(paused ? {} : { state: Object.fromEntries(Object.entries(a.state).map(([k, v]) => [k, { ...v, holds: true }])) }) };
        }),
      );
      if (!found) throw new Error("This alert cannot be paused: it is done or gone.");
      if (!paused) await ctx.trigger("check");
      return { paused };
    });
    /* The pairs the form offers: BytNode's. */
    ctx.api("pairs", async (_params, { signal }) => bytnodePairs(APP_PASS, signal));
    /* What a condition reads now on a pair, while the user writes it. */
    ctx.api("preview", async (params, { transport, signal }) => {
      const condition = parseCondition(String(params.condition ?? ""));
      if ("error" in condition) throw new Error(condition.error);
      const raw = String(params.target ?? "");
      const onList = raw.toLowerCase() === WATCHLIST;
      const list = watchlist();
      if (onList && !list) throw new Error(WATCHLIST_OFF);
      const symbol = onList ? (await list!.symbols())[0] : normalizeSymbol(raw);
      if (!symbol) throw new Error(onList ? "The watchlist is empty." : `Not a pair: "${raw}".`);
      if (onPosition(condition)) return { symbol, error: "Read on the position at the first check." };
      const accountId = typeof params.accountId === "string" ? params.accountId : undefined;
      const reading = await readAll([{ symbol, condition, accountId }], { bytnodeKey: APP_PASS, accounts: transport.exchangeAccounts, signal }, calendar());
      const read = reading(symbol, accountId);
      return { symbol, ...evaluate(condition, read, new Date()), value: currentValue(condition, read) };
    });
  },
});
