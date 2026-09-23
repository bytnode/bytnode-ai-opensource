/* ---------------------------------------------------------------------------
   The market events table: what it holds, what gets in, how it is searched.

   Every event is SOURCED: a collected event without an http(s) URL is
   rejected, never stored. The same event collected twice is updated, not
   duplicated: its key is the source's id when there is one, otherwise the
   day and the title. Thirty days of past events are kept, all the known
   future. Pure, tested.
--------------------------------------------------------------------------- */

export const CATEGORIES = ["macro", "unlock", "listing", "expiry", "upgrade", "project"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  macro: "Macro",
  unlock: "Token unlock",
  listing: "Listing / delisting",
  expiry: "Options & futures expiry",
  upgrade: "Upgrade / fork",
  project: "Project",
};

export type CalendarEvent = {
  id: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  allDay: boolean;
  category: Category;
  title: string;
  /** Base assets concerned (`BTC`); empty: the whole market. */
  assets: string[];
  importance: 1 | 2 | 3;
  source: string;
  url: string;
  /** When it was collected (or computed). */
  fetchedAt: string;
  /** Computed from a venue's schedule (an expiry), not collected. */
  computed?: true;
};

const DAY = 24 * 3600_000;
export const RETENTION_DAYS = 30;
const MAX_TITLE = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** FNV-1a, twice with two seeds: a short stable key, in the browser too. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The key of an event: the source's id, or the day and the title. */
export function eventKey(day: string, title: string, sourceId?: string): string {
  if (sourceId?.trim()) return sourceId.trim().slice(0, 120);
  return hash(`${day}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`);
}

/** A collected event, checked: the event, or why it is rejected. */
export function validateEvent(raw: unknown, now: Date): CalendarEvent | { error: string } {
  if (!isRecord(raw)) return { error: "not an object" };
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE) : "";
  if (!title) return { error: "no title" };
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    /* rejected below */
  }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return { error: `no source URL: "${title}"` };
  const starts = typeof raw.startsAt === "string" ? Date.parse(raw.startsAt) : NaN;
  if (!Number.isFinite(starts)) return { error: `no valid date: "${title}"` };
  const category = CATEGORIES.find((c) => c === raw.category);
  if (!category) return { error: `unknown category "${String(raw.category)}": "${title}"` };
  const importance = raw.importance === 1 || raw.importance === 2 || raw.importance === 3 ? raw.importance : 1;
  const assets = Array.isArray(raw.assets) ? [...new Set(raw.assets.filter((a): a is string => typeof a === "string").map((a) => a.trim().toUpperCase().split("/")[0]).filter((a) => /^[A-Z0-9]{2,15}$/.test(a)))] : [];
  const startsAt = new Date(starts).toISOString();
  const allDay = raw.allDay === true;
  return {
    id: eventKey(startsAt.slice(0, 10), title, typeof raw.id === "string" ? raw.id : undefined),
    startsAt,
    allDay,
    category,
    title,
    assets,
    importance,
    source: typeof raw.source === "string" && raw.source.trim() ? raw.source.trim().slice(0, 80) : parsed.hostname,
    url: parsed.toString(),
    fetchedAt: now.toISOString(),
  };
}

/** Merges collected events into the table: new ones added, known ones
    (same key, or same URL on the same day) updated — never duplicated —
    and the old past dropped. */
export function mergeEvents(stored: CalendarEvent[], incoming: CalendarEvent[], now: Date): { events: CalendarEvent[]; added: number; updated: number } {
  const byId = new Map(stored.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  for (const e of incoming) {
    const same = byId.get(e.id) ?? [...byId.values()].find((x) => x.url === e.url && x.startsAt.slice(0, 10) === e.startsAt.slice(0, 10));
    if (same) {
      byId.delete(same.id);
      byId.set(same.id, { ...e, id: same.id });
      updated++;
    } else {
      byId.set(e.id, e);
      added++;
    }
  }
  return { events: prune([...byId.values()], now), added, updated };
}

/** Keeps 30 days of past events and the whole future, in date order. */
export const prune = (events: CalendarEvent[], now: Date): CalendarEvent[] =>
  events.filter((e) => Date.parse(e.startsAt) >= now.getTime() - RETENTION_DAYS * DAY).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

export type EventQuery = {
  from: Date;
  to: Date;
  categories?: Category[];
  /** Base assets; an event of the whole market (no asset) matches too. */
  assets?: string[];
  minImportance?: number;
  text?: string;
};

export function searchEvents(events: CalendarEvent[], q: EventQuery): CalendarEvent[] {
  const assets = q.assets?.map((a) => a.toUpperCase().split("/")[0]);
  const text = q.text?.trim().toLowerCase();
  return events
    .filter((e) => {
      const t = Date.parse(e.startsAt);
      if (t < q.from.getTime() - (e.allDay ? DAY : 0) || t > q.to.getTime()) return false;
      if (q.categories?.length && !q.categories.includes(e.category)) return false;
      if (q.minImportance && e.importance < q.minImportance) return false;
      if (assets?.length && e.assets.length && !e.assets.some((a) => assets.includes(a))) return false;
      if (text && !`${e.title} ${e.assets.join(" ")} ${e.source}`.toLowerCase().includes(text)) return false;
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** An event in one line, with its source and collection date (or that it
    is computed). */
export function eventLine(e: CalendarEvent): string {
  const when = e.allDay ? `${e.startsAt.slice(0, 10)} (all day)` : `${e.startsAt.slice(0, 16).replace("T", " ")} UTC`;
  const assets = e.assets.length ? ` [${e.assets.join(", ")}]` : "";
  return `${when} — ${e.title}${assets} · ${CATEGORY_LABELS[e.category]}, importance ${e.importance} · source: ${e.source} ${e.url} (${e.computed ? "computed, not collected" : `collected ${e.fetchedAt.slice(0, 10)}`})`;
}

const PROMPT_HOURS = 48;
const PROMPT_MAX = 3;

/** The prompt section: the most important events of the next 48 hours
    (at most 3), so the agent can mention them unprompted. */
export function calendarPrompt(events: CalendarEvent[], now: Date): string {
  const soon = searchEvents(events, { from: now, to: new Date(now.getTime() + PROMPT_HOURS * 3600_000), minImportance: 3 }).slice(0, PROMPT_MAX);
  if (soon.length === 0) return "";
  return ["## Market events in the next 48 hours", ...soon.map((e) => `- ${eventLine(e)}`), "EventSearch finds the others."].join("\n");
}
