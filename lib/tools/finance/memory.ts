import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool } from "../types";
import { fail, ok } from "../types";
import { withLock, writeTextAtomic } from "@/lib/plugins/core/store";
import { MEMORY_FILE, addEntry, formatEntry, parseMemory, removeEntry, renderMemoryPrompt, searchEntries, serializeMemory, type MemoryEntry } from "./memory-store";

/* Memory: the agent's persistent memory, in its workspace.

   ⚠️ SEVERAL WRITERS AT ONCE. The file is shared with the subscription
   agents (same folder, served by the MCP server — another PROCESS), they
   issue tool calls in parallel, and Workflow sub-agents write in the same
   workspace three at a time. A read-modify-write without a lock kept one
   note of ten, each call reporting success. Every change now takes the
   file's cross-process lock (`withLock`, the plugin stores' lock) and
   writes through a temporary file renamed over the old one. */

type Args = { action: "add" | "list" | "search" | "remove"; text?: string; tags?: string[]; query?: string; id?: string };

const memoryFile = (workspace: string) => path.join(workspace, MEMORY_FILE);

export async function readMemory(workspace: string): Promise<MemoryEntry[]> {
  try {
    return parseMemory(await fs.readFile(memoryFile(workspace), "utf8"));
  } catch {
    return [];
  }
}

/** Read, change, write — under the lock. `change` returns the new list, or
    `null` to write nothing. */
export async function updateMemory<T>(workspace: string, change: (entries: MemoryEntry[]) => { next: MemoryEntry[] | null; result: T }): Promise<T> {
  const file = memoryFile(workspace);
  return withLock(file, async () => {
    const { next, result } = change(await readMemory(workspace));
    if (next) await writeTextAtomic(file, serializeMemory(next));
    return result;
  });
}

/** The prompt block, ready to be appended to the system prompt. */
export async function memoryPrompt(workspace: string): Promise<string> {
  return renderMemoryPrompt(await readMemory(workspace));
}

const shortId = () => randomUUID().slice(0, 8);
const notes = (n: number) => `${n} note${n === 1 ? "" : "s"}`;

export const memoryTool: Tool<Args> = {
  name: "Memory",
  policy: { gated: false, subagent: true },
  description:
    "Your memory across conversations, specific to this agent. `add`: keep a short dated note (a market thesis, a watched level, a tested strategy and its verdict, a user preference) with tags; " +
    "`list`: read everything back; `search`: look up by words; `remove`: delete a note by its id. The latest notes are already in your prompt (Memory section). " +
    "Note what is worth outliving the conversation, not what can be read again in the data.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "list", "search", "remove"] },
      text: { type: "string", description: "add: the note (one to three sentences, one line)." },
      tags: { type: "array", items: { type: "string" }, description: "add: keywords (btc, macro, strategy…)." },
      query: { type: "string", description: "search: the words to look for." },
      id: { type: "string", description: "remove: the note's id." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    switch (args.action) {
      case "add": {
        const text = args.text ?? "";
        if (!text.trim()) return fail("`text` is required for add.");
        return updateMemory(ctx.workspace, (entries) => {
          const next = addEntry(entries, text, args.tags ?? [], shortId, Date.now);
          if (next.length === entries.length && next.every((e, i) => e === entries[i])) return { next: null, result: ok("Already in memory, nothing added.") };
          return { next, result: ok(`Kept ${formatEntry(next[next.length - 1])}\n(${notes(next.length)} in memory)`) };
        });
      }
      case "list": {
        const entries = await readMemory(ctx.workspace);
        return ok(entries.length ? entries.map(formatEntry).join("\n") : "Memory is empty.");
      }
      case "search": {
        const found = searchEntries(await readMemory(ctx.workspace), args.query ?? "");
        return ok(found.length ? found.map(formatEntry).join("\n") : `Nothing for "${args.query ?? ""}".`);
      }
      case "remove": {
        const id = args.id;
        if (!id) return fail("`id` is required for remove.");
        return updateMemory(ctx.workspace, (entries) => {
          const next = removeEntry(entries, id);
          if (next.length === entries.length) return { next: null, result: fail(`No note with the id ${id}.`) };
          return { next, result: ok(`Removed. ${notes(next.length)} left.`) };
        });
      }
      default:
        return fail(`Unknown action: ${String(args.action)}`);
    }
  },
};
