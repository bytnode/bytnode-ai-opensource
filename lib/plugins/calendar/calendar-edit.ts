import type { Tool, ToolContext } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import type { Edit, EditResult } from "./edit";
import { WRITABLE, eventLine } from "./events";

/* CalendarEdit: your agents write the calendar — the market events they
   find (each with the page that announces it) and the user's own entries:
   tasks, reminders, deadlines, notes. It changes nothing but the user's
   calendar, so it asks no permission, and background runs have it too: a
   scheduled task can fill the calendar. The computed calendars (expiries,
   scheduled runs) are out of its reach. */

type Args = Edit;

const ENTRY = {
  startsAt: { type: "string", description: "ISO 8601, e.g. 2026-10-29T18:00:00Z. For a whole day: that day at 00:00Z with `allDay: true`." },
  allDay: { type: "boolean" },
  category: { type: "string", enum: [...WRITABLE], description: "`task` for the user's own entries (tasks, reminders, deadlines, notes); the others are market events." },
  title: { type: "string" },
  assets: { type: "array", items: { type: "string" }, description: "Base assets concerned (BTC, ETH…); empty for the whole market." },
  importance: { type: "integer", minimum: 1, maximum: 3, description: "3 = expected market impact (FOMC, CPI, a large unlock), 2 = notable, 1 = minor." },
  source: { type: "string", description: "Who announces it (a market event)." },
  url: { type: "string", description: "The page that announces it: required for a market event, optional for a task." },
  notes: { type: "string", description: "A few lines of context (at most 1000 characters)." },
};

export function calendarEditTool(apply: (edit: Edit, ctx: ToolContext) => Promise<EditResult>): Tool<Args> {
  return {
    name: "CalendarEdit",
    policy: { readOnly: false, gated: false, subagent: true },
    description:
      "Writes the user's calendar (the Calendar tab). `add` entries: market events you found (macro, unlock, listing, upgrade, project — each needs the `url` of a page that announces it; never guess a date) or the user's own entries (`task`: a task, a reminder, a deadline, a note — no source needed). " +
      "`update` an entry by its id (EventSearch shows the ids): any field, or `done: true` to tick a task off. `remove` entries by id. The options and futures expiries and the scheduled tasks' runs are computed: TaskSchedule and TaskCancel manage the latter.",
    parameters: {
      type: "object",
      properties: {
        add: { type: "array", items: { type: "object", properties: ENTRY, required: ["startsAt", "category", "title"], additionalProperties: false } },
        update: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, ...ENTRY, done: { type: "boolean", description: "A task: true when done, false to reopen it." } }, required: ["id"], additionalProperties: false },
        },
        remove: { type: "array", items: { type: "string" }, description: "Ids of the entries to remove." },
      },
      additionalProperties: false,
    },
    async execute(args, ctx) {
      if (!args.add?.length && !args.update?.length && !args.remove?.length) return fail("Give `add`, `update` or `remove`.");
      const r = await apply(args, ctx);
      const lines = [
        ...(r.added.length ? [`Added ${r.added.length}:`, ...r.added.map((e) => `- ${eventLine(e)}`)] : []),
        ...(r.updated.length ? [`Updated ${r.updated.length}:`, ...r.updated.map((e) => `- ${eventLine(e)}`)] : []),
        ...(r.removed.length ? [`Removed: ${r.removed.map((e) => `"${e.title}"`).join(", ")}.`] : []),
        ...(r.rejected.length ? [`Rejected: ${r.rejected.join("; ")}.`] : []),
      ];
      const done = r.added.length + r.updated.length + r.removed.length;
      return done ? ok(lines.join("\n")) : fail(lines.join("\n") || "Nothing changed.");
    },
  };
}
