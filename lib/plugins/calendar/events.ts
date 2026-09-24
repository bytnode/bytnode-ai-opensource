/* ---------------------------------------------------------------------------
   The calendar's table: what it holds, what gets in, how it is searched.

   Your agents write it (`CalendarEdit`): market events, each SOURCED — one
   without an http(s) URL is rejected, never stored — and the user's own
   entries (tasks, reminders, deadlines: the `task` calendar), which need no
   source. The same event written twice is updated, not duplicated: its key
   is the day and the title. Two calendars are COMPUTED, never stored: the
   options and futures expiries (`expiries.ts`) and the coming runs of the
   scheduled tasks. Thirty days of past entries are kept, all the known
   future. Pure, tested.
--------------------------------------------------------------------------- */

export const CATEGORIES = ["macro", "unlock", "listing", "expiry", "upgrade", "project", "task", "scheduled"] as const;
export type Category = (typeof CATEGORIES)[number];

/** The calendars an agent writes; the two others are computed. */
export const WRITABLE = ["macro", "unlock", "listing", "upgrade", "project", "task"] as const satisfies readonly Category[];

export const CATEGORY_LABELS: Record<Category, string> = {
  macro: "Macro",
  unlock: "Token unlock",
  listing: "Listing / delisting",
  expiry: "Options & futures expiry",
  upgrade: "Upgrade / fork",
  project: "Project",
  task: "Task",
  scheduled: "Scheduled task",
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
  /** Who announces it — for a task, the agent that wrote it. */
  source: string;
  /** The page that announces it; empty for a task or a scheduled run. */
  url: string;
  /** When it was written (or computed). */
  fetchedAt: string;
  /** A few lines of context, written by the agent. */
  notes?: string;
  /** The id of the agent that wrote it, when known (its name is in `source`
      for a task, and the view names it from the settings) — or `USER`: the
      user added it in the view. */
  by?: string;
  /** A task the agent marked done. */
  done?: true;
  /** Computed (an expiry, a scheduled run), not written: nobody edits it. */
  computed?: true;
};

const DAY = 24 * 3600_000;
export const RETENTION_DAYS = 30;
const MAX_TITLE = 200;
const MAX_NOTES = 1000;

/** `by` of an entry the user added in the view: it needs no source. */
export const USER = "user";

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

/** The key of an entry: its day and its title. */
export function eventKey(day: string, title: string): string {
  return hash(`${day}|${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`);
}

/** An entry as an agent writes it, checked: the entry, or why it is
    rejected. `by`: the agent's name, the source of a task. `sourceless`:
    the user's own entry — they vouch for it, no URL is asked. */
export function validateEvent(raw: unknown, now: Date, by = "an agent", sourceless = false): CalendarEvent | { error: string } {
  if (!isRecord(raw)) return { error: "not an object" };
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE) : "";
  if (!title) return { error: "no title" };
  const category = CATEGORIES.find((c) => c === raw.category);
  if (!category) return { error: `unknown category "${String(raw.category)}": "${title}"` };
  if (category === "expiry" || category === "scheduled") return { error: `${category === "expiry" ? "expiries" : "scheduled runs"} are computed, not written: "${title}"` };
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  let parsed: URL | null = null;
  try {
    parsed = url ? new URL(url) : null;
  } catch {
    /* rejected below */
  }
  if (parsed && !/^https?:$/.test(parsed.protocol)) parsed = null;
  if (!parsed && (url || (category !== "task" && !sourceless))) return { error: `no source URL: "${title}"` };
  const starts = typeof raw.startsAt === "string" ? Date.parse(raw.startsAt) : NaN;
  if (!Number.isFinite(starts)) return { error: `no valid date: "${title}"` };
  const importance = raw.importance === 1 || raw.importance === 2 || raw.importance === 3 ? raw.importance : 1;
  const assets = Array.isArray(raw.assets) ? [...new Set(raw.assets.filter((a): a is string => typeof a === "string").map((a) => a.trim().toUpperCase().split("/")[0]).filter((a) => /^[A-Z0-9]{2,15}$/.test(a)))] : [];
  const startsAt = new Date(starts).toISOString();
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, MAX_NOTES) : "";
  const source = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim().slice(0, 80) : parsed ? parsed.hostname : by;
  return {
    id: eventKey(startsAt.slice(0, 10), title),
    startsAt,
    allDay: raw.allDay === true,
    category,
    title,
    assets,
    importance,
    source,
    url: parsed ? parsed.toString() : "",
    fetchedAt: now.toISOString(),
    ...(notes ? { notes } : {}),
    ...(raw.done === true && category === "task" ? { done: true as const } : {}),
  };
}

/** Merges written events into the table: new ones added, known ones
    (same key, or same URL on the same day) updated — never duplicated —
    and the old past dropped. */
export function mergeEvents(stored: CalendarEvent[], incoming: CalendarEvent[], now: Date): { events: CalendarEvent[]; added: CalendarEvent[]; updated: CalendarEvent[] } {
  const byId = new Map(stored.map((e) => [e.id, e]));
  const added: CalendarEvent[] = [];
  const updated: CalendarEvent[] = [];
  for (const e of incoming) {
    const same = byId.get(e.id) ?? [...byId.values()].find((x) => e.url !== "" && x.url === e.url && x.startsAt.slice(0, 10) === e.startsAt.slice(0, 10));
    if (same) {
      const next = { ...e, id: same.id };
      byId.delete(same.id);
      byId.set(same.id, next);
      updated.push(next);
    } else {
      byId.set(e.id, e);
      added.push(e);
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
      if (text && !`${e.title} ${e.assets.join(" ")} ${e.source} ${e.notes ?? ""}`.toLowerCase().includes(text)) return false;
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** An entry in one line, with its id (to edit it), its source and when
    it was written — or that it is computed. */
export function eventLine(e: CalendarEvent): string {
  const when = e.allDay ? `${e.startsAt.slice(0, 10)} (all day)` : `${e.startsAt.slice(0, 16).replace("T", " ")} UTC`;
  const assets = e.assets.length ? ` [${e.assets.join(", ")}]` : "";
  const what = e.category === "task" || e.category === "scheduled" ? CATEGORY_LABELS[e.category] : `${CATEGORY_LABELS[e.category]}, importance ${e.importance}`;
  const origin = e.computed ? "computed, not editable" : `id ${e.id}, written ${e.fetchedAt.slice(0, 10)}`;
  const notes = e.notes ? ` · notes: ${e.notes.replace(/\s+/g, " ").slice(0, 200)}` : "";
  return `${when} — ${e.title}${e.done ? " (done)" : ""}${assets} · ${what} · source: ${e.source}${e.url ? ` ${e.url}` : ""} (${origin})${notes}`;
}

const PROMPT_HOURS = 48;
const PROMPT_MAX = 3;

/** The prompt section: the most important market events of the next 48
    hours and the user's open tasks due by then (at most 3 each), so the
    agent can mention them unprompted. */
export function calendarPrompt(events: CalendarEvent[], now: Date): string {
  const soon = searchEvents(events, { from: now, to: new Date(now.getTime() + PROMPT_HOURS * 3600_000) });
  const market = soon.filter((e) => e.importance === 3 && e.category !== "task" && e.category !== "scheduled").slice(0, PROMPT_MAX);
  const tasks = soon.filter((e) => e.category === "task" && !e.done).slice(0, PROMPT_MAX);
  if (market.length === 0 && tasks.length === 0) return "";
  return [
    ...(market.length ? ["## Market events in the next 48 hours", ...market.map((e) => `- ${eventLine(e)}`)] : []),
    ...(tasks.length ? ["## The user's tasks in the next 48 hours", ...tasks.map((e) => `- ${eventLine(e)}`)] : []),
    "EventSearch finds the others; CalendarEdit writes to the calendar.",
  ].join("\n");
}
