import { RETENTION_DAYS, USER, mergeEvents, validateEvent, type CalendarEvent } from "./events";

/* ---------------------------------------------------------------------------
   An edit of the calendar: entries added, changed, removed — what
   `CalendarEdit` and the view's "Delete" do to the stored table.

   An added entry is checked like any other (`validateEvent`: a market
   event needs its source URL, a task does not) and merged without
   duplicates. A change is the stored entry with the fields given laid
   over it, checked again, under the same id. The computed calendars
   (expiries, scheduled runs) are never stored, so an id of theirs is
   "not found". Pure, tested.
--------------------------------------------------------------------------- */

export type EntryInput = Record<string, unknown>;
export type Edit = { add?: EntryInput[]; update?: Array<{ id: string } & EntryInput>; remove?: string[] };

export type EditResult = { events: CalendarEvent[]; added: CalendarEvent[]; updated: CalendarEvent[]; removed: CalendarEvent[]; rejected: string[] };

/** The fields a change may set; the id stays. */
const CHANGEABLE = ["startsAt", "allDay", "category", "title", "assets", "importance", "source", "url", "notes", "done"] as const;
const DAY = 24 * 3600_000;

/** Who writes: an agent — its name (a task's source) and its id, when
    known — or the user in the view (`user`), whose entries need no source. */
export type Author = { name: string; agentId?: string; user?: true };

export function editCalendar(stored: CalendarEvent[], edit: Edit, now: Date, author: Author): EditResult {
  const rejected: string[] = [];
  const removed: CalendarEvent[] = [];
  const changed = new Map<string, CalendarEvent>();
  const oldest = now.getTime() - RETENTION_DAYS * DAY;
  const tooOld = (e: CalendarEvent) => Date.parse(e.startsAt) < oldest;
  let events = stored;

  for (const id of edit.remove ?? []) {
    const found = events.find((e) => e.id === id);
    if (!found) rejected.push(`no entry "${id}" to remove`);
    else {
      removed.push(found);
      events = events.filter((e) => e.id !== id);
    }
  }

  for (const change of edit.update ?? []) {
    const current = events.find((e) => e.id === change.id);
    if (!current) {
      rejected.push(`no entry "${change.id}" to change (computed entries cannot be)`);
      continue;
    }
    const merged: EntryInput = { ...current };
    for (const k of CHANGEABLE) if (change[k] !== undefined) merged[k] = change[k];
    const checked = validateEvent(merged, now, current.source, current.by === USER);
    if ("error" in checked) rejected.push(checked.error);
    else if (tooOld(checked)) rejected.push(`more than ${RETENTION_DAYS} days in the past: "${checked.title}"`);
    else {
      const next = { ...checked, id: current.id, ...(current.by ? { by: current.by } : {}) };
      events = events.map((e) => (e.id === current.id ? next : e));
      changed.set(next.id, next);
    }
  }

  const valid: CalendarEvent[] = [];
  for (const raw of edit.add ?? []) {
    const e = validateEvent(raw, now, author.name, author.user);
    const by = author.user ? USER : author.agentId;
    if ("error" in e) rejected.push(e.error);
    else if (tooOld(e)) rejected.push(`more than ${RETENTION_DAYS} days in the past: "${e.title}"`);
    else valid.push(by ? { ...e, by } : e);
  }
  const merged = mergeEvents(events, valid, now);
  for (const e of merged.updated) changed.set(e.id, e);
  return { events: merged.events, added: merged.added, updated: [...changed.values()], removed, rejected };
}
