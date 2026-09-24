import type { Candle } from "../shared/candle";
import type { DcaPlan, Purchase } from "./plans";

/* ---------------------------------------------------------------------------
   Groups of DCAs — a project ("Long term", "Altcoins") holding recurring
   purchases: the view's column lists the groups only, a group opens its
   DCAs. Every DCA belongs to one group (one left without, from before the
   groups, is taken into the first); deleting a group deletes its DCAs.
   And the value of a set of DCAs day by day, for the view's curve.
   Pure, tested.
--------------------------------------------------------------------------- */

export type DcaGroup = { id: string; name: string; createdAt: string };

export const MAX_GROUP_NAME = 40;
/** The group the tab opens with, made once: deleted, it does not come back. */
export const DEFAULT_GROUP = "My DCA";
export const MAX_GROUPS = 50;

type Failed = { error: string };

function cleanName(name: unknown, groups: DcaGroup[], except?: string): string | Failed {
  const text = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!text) return { error: "Give the group a name." };
  if (text.length > MAX_GROUP_NAME) return { error: `A group's name is at most ${MAX_GROUP_NAME} characters.` };
  if (groups.some((g) => g.id !== except && g.name.toLowerCase() === text.toLowerCase())) return { error: `A group is already named "${text}".` };
  return text;
}

/** The groups as first read: none ever made (`null`, no file yet) gives
    the default one; an emptied list stays empty. */
export function seedGroups(stored: DcaGroup[] | null, id: string, now: Date): DcaGroup[] {
  return stored ?? [{ id, name: DEFAULT_GROUP, createdAt: now.toISOString() }];
}

/** The group of that name, whatever its case. */
export const groupNamed = (groups: DcaGroup[], name: string): DcaGroup | undefined => groups.find((g) => g.name.toLowerCase() === name.trim().toLowerCase());

export function addGroup(groups: DcaGroup[], name: unknown, id: string, now: Date): { groups: DcaGroup[]; group: DcaGroup } | Failed {
  if (groups.length >= MAX_GROUPS) return { error: `At most ${MAX_GROUPS} groups.` };
  const clean = cleanName(name, groups);
  if (typeof clean !== "string") return clean;
  const group: DcaGroup = { id, name: clean, createdAt: now.toISOString() };
  return { groups: [...groups, group], group };
}

export function renameGroup(groups: DcaGroup[], id: string, name: unknown): { groups: DcaGroup[]; group: DcaGroup } | Failed {
  const found = groups.find((g) => g.id === id);
  if (!found) return { error: "No such group." };
  const clean = cleanName(name, groups, id);
  if (typeof clean !== "string") return clean;
  const group = { ...found, name: clean };
  return { groups: groups.map((g) => (g.id === id ? group : g)), group };
}

/** The group goes, and its DCAs with it (they stop; what they bought
    stays where it is). */
export function removeGroup(groups: DcaGroup[], plans: DcaPlan[], id: string): { groups: DcaGroup[]; plans: DcaPlan[] } | Failed {
  if (!groups.some((g) => g.id === id)) return { error: "No such group." };
  return { groups: groups.filter((g) => g.id !== id), plans: plans.filter((p) => p.groupId !== id) };
}

/** A DCA into another group. */
export function movePlan(plans: DcaPlan[], groups: DcaGroup[], planId: string, groupId: string): { plans: DcaPlan[]; plan: DcaPlan } | Failed {
  const found = plans.find((p) => p.id === planId);
  if (!found) return { error: `No DCA plan "${planId}".` };
  if (!groups.some((g) => g.id === groupId)) return { error: "No such group." };
  const plan: DcaPlan = { ...found, groupId };
  return { plans: plans.map((p) => (p.id === planId ? plan : p)), plan };
}

/** Every DCA in a group: those in none (or in a group gone) go into the
    first — made, the default one, when there is no group. */
export function adoptLoose(plans: DcaPlan[], groups: DcaGroup[], id: string, now: Date): { plans: DcaPlan[]; groups: DcaGroup[]; changed: boolean } {
  const known = new Set(groups.map((g) => g.id));
  if (plans.every((p) => p.groupId && known.has(p.groupId))) return { plans, groups, changed: false };
  const all = groups.length ? groups : seedGroups(null, id, now);
  const home = all[0].id;
  const kept = new Set(all.map((g) => g.id));
  return { plans: plans.map((p) => (p.groupId && kept.has(p.groupId) ? p : { ...p, groupId: home })), groups: all, changed: true };
}

/* --- The value of a set of plans, day by day ----------------------------- */

const DAY = 86_400_000;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const endOf = (day: string) => Date.parse(`${day}T23:59:59.999Z`);

/** A close on a day: that day's, else the latest before; else the first. */
function closeOn(bars: Candle[] | undefined, day: string): number | undefined {
  if (!bars?.length) return undefined;
  const end = endOf(day);
  let found: number | undefined;
  for (const b of bars) {
    if (b.t <= end) found = b.c;
    else break;
  }
  return found ?? bars[0].c;
}

/** The days from the first purchase to `now` (at most `max`). */
export function curveDays(purchases: Purchase[], now: Date, max = 365): string[] {
  const filled = purchases.filter((p) => p.status === "filled" && p.amount !== undefined);
  if (!filled.length) return [];
  const today = Date.parse(`${dayOf(now.getTime())}T00:00:00Z`);
  const first = Math.max(Date.parse(`${dayOf(Math.min(...filled.map((p) => Date.parse(p.at))))}T00:00:00Z`), today - (max - 1) * DAY);
  const out: string[] = [];
  for (let t = first; t <= today; t += DAY) out.push(dayOf(t));
  return out;
}

/** Each day's value of what the plans bought so far, at the day's close
    (the purchase's own price when the day has none); a bar's `v` is what
    was invested that day — the chart's daily returns take it off, so a
    purchase is not a gain. */
export function planCurve(plans: DcaPlan[], purchases: Purchase[], closes: Record<string, Candle[]>, days: string[]): Candle[] {
  const bySymbol = new Map(plans.map((p) => [p.id, p.symbol]));
  const fills = purchases
    .filter((p) => p.status === "filled" && p.amount !== undefined && p.price !== undefined && bySymbol.has(p.planId))
    .map((p) => ({ t: Date.parse(p.at), symbol: bySymbol.get(p.planId)!, amount: p.amount!, cost: p.amount! * p.price!, price: p.price! }))
    .sort((a, b) => a.t - b.t);
  const held: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
  const out: Candle[] = [];
  let i = 0;
  for (const day of days) {
    let invested = 0;
    for (; i < fills.length && fills[i].t <= endOf(day); i++) {
      held[fills[i].symbol] = (held[fills[i].symbol] ?? 0) + fills[i].amount;
      lastPrice[fills[i].symbol] = fills[i].price;
      invested += fills[i].cost;
    }
    let value = 0;
    for (const [symbol, amount] of Object.entries(held)) value += amount * (closeOn(closes[symbol], day) ?? lastPrice[symbol] ?? 0);
    const c = Math.round(value * 100) / 100;
    out.push({ t: Date.parse(`${day}T00:00:00Z`), o: c, h: c, l: c, c, v: Math.round(invested * 100) / 100 });
  }
  return out;
}
