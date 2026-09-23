import type { Tool } from "@/lib/tools/types";
import { fail, ok } from "@/lib/tools/types";
import { editWatchlist, type Watchlist } from "./list";

/* WatchlistEdit: add or remove assets, with an optional note. It changes
   nothing but the user's list — free to use, but kept from sub-agents:
   what the user follows is theirs to decide. */

type Args = { add?: string[]; remove?: string[]; note?: string; tags?: string[] };

export function watchlistEditTool(update: (change: (list: Watchlist) => Watchlist) => Promise<Watchlist>, changed: () => void): Tool<Args> {
  return {
    name: "WatchlistEdit",
    policy: { gated: false, subagent: false },
    description:
      "Adds assets to the user's watchlist or removes them (\"btc\", \"ETH/USDT\", \"SOLUSDT\" are understood), with an optional note and tags for the added ones. Only when the user asks for it.",
    parameters: {
      type: "object",
      properties: {
        add: { type: "array", items: { type: "string" }, description: "Symbols to add (or whose note to update)." },
        remove: { type: "array", items: { type: "string" }, description: "Symbols to remove." },
        note: { type: "string", description: "A short note on the added assets." },
        tags: { type: "array", items: { type: "string" }, description: "Tags for the added assets." },
      },
      additionalProperties: false,
    },
    async execute(args) {
      if (!args.add?.length && !args.remove?.length) return fail("Give `add` or `remove`.");
      let report = { added: [] as string[], removed: [] as string[], invalid: [] as string[] };
      const list = await update((current) => {
        const r = editWatchlist(current, args, new Date());
        report = r;
        return r.list;
      });
      changed();
      const parts = [
        report.added.length ? `Added: ${report.added.join(", ")}.` : "",
        report.removed.length ? `Removed: ${report.removed.join(", ")}.` : "",
        report.invalid.length ? `Not understood or not in the list: ${report.invalid.join(", ")}.` : "",
        `The watchlist holds ${list.items.length} asset${list.items.length > 1 ? "s" : ""}: ${list.items.map((x) => x.symbol).join(", ") || "none"}.`,
      ];
      return ok(parts.filter(Boolean).join(" "));
    },
  };
}
