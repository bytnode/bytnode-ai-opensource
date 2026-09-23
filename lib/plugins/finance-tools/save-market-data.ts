import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "@/lib/tools/types";
import { errorText, fail, ok } from "@/lib/tools/types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "@/lib/tools/paths";
import { bytnodeTools, readBytnodeTool } from "@/lib/mcp/bytnode";
import { detectColumns, rowsOf, toCsv, toMillis, type Row } from "./csv";

/* ---------------------------------------------------------------------------
   SaveMarketData: BytNode data to a file, without going through the model.

   Calls a BytNode tool (`get_history`, `get_market_data`…) with its
   arguments, finds the table in the response, writes it as CSV in the
   workspace and hands the model only a summary: columns, number of rows,
   first and last date. Two thousand candles no longer go through the
   context — they are on disk, ready for Chart, Backtest or pandas.
--------------------------------------------------------------------------- */

type Args = { tool: string; args?: Record<string, unknown>; output: string; append?: boolean };

const MAX_ROWS = 200_000;

export const saveMarketDataTool: Tool<Args> = {
  name: "SaveMarketData",
  policy: { gated: false, subagent: true },
  description:
    "Queries a BytNode data tool (`get_history`, `get_market_data`, `get_market_indicators`…) and saves the resulting table as CSV in the workspace, without it going through the conversation. " +
    "Use it as soon as there are more than a few dozen rows (candle history, indicator series): you receive a summary (columns, number of rows, period) and the file is ready for Chart, Backtest or a pandas script. " +
    "`tool` and `args` are exactly those you would pass to the BytNode tool (see `get_system_info` for the parameters). `append: true` appends to an existing CSV (same columns) instead of replacing it.",
  parameters: {
    type: "object",
    properties: {
      tool: { type: "string", description: "The BytNode tool to call." },
      args: { type: "object", description: "Its arguments.", additionalProperties: true },
      output: { type: "string", description: "The CSV to write, relative to the workspace (e.g. data/btc_4h.csv)." },
      append: { type: "boolean", description: "Append at the end of the file instead of replacing it." },
    },
    required: ["tool", "output"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const key = ctx.bytnodeKey?.trim();
    if (!key) return fail("No BytNode key: the data source is not connected. Tell the user (Settings → Auth).");
    let out: string;
    try {
      out = resolvePath(ctx.workspace, args.output, ctx.scope);
    } catch (e) {
      return fail(e instanceof OutsideWorkspaceError ? e.message : errorText(e));
    }
    if (!/\.csv$/i.test(out)) return fail("The output file must be a .csv.");
    const infos = await bytnodeTools(key).catch(() => []);
    if (infos.length && !infos.some((t) => t.name === args.tool)) {
      return fail(`Unknown BytNode tool: ${args.tool}. Available: ${infos.map((t) => t.name).join(", ")}.`);
    }
    /* The whole answer: this tool exists for series too long for the
       model's context, so it must not read them through the model's cut. */
    const res = await readBytnodeTool(key, args.tool, args.args ?? {}, ctx.signal);
    if (!res.ok) return fail(res.message);
    const text = res.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON: maybe CSV, or text */
      if (/^[^\n]+,[^\n]+\n/.test(text)) {
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, text);
        return ok(`BytNode returned CSV; written as is to ${displayPath(ctx.workspace, out)} (${text.split("\n").length - 1} rows).`);
      }
      return fail(`The response of ${args.tool} is not a table (free text):\n${text.slice(0, 1500)}`);
    }
    let rows = rowsOf(parsed);
    if (!rows || rows.length === 0) return fail(`No table found in the response of ${args.tool}:\n${JSON.stringify(parsed).slice(0, 1500)}`);
    if (rows.length > MAX_ROWS) rows = rows.slice(-MAX_ROWS);

    const columns = Array.from(rows.reduce((set, r) => (Object.keys(r).forEach((k) => set.add(k)), set), new Set<string>()));
    const cols = detectColumns(columns);
    /* Chronological order, when time can be read. */
    if (cols.time) {
      const t = cols.time;
      rows = rows.slice().sort((a, b) => (toMillis(a[t]) ?? 0) - (toMillis(b[t]) ?? 0));
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    let total = rows.length;
    if (args.append) {
      let existing = "";
      try {
        existing = await fs.readFile(out, "utf8");
      } catch {
        /* no file yet */
      }
      if (existing.trim()) {
        const head = existing.split(/\r?\n/)[0];
        if (head !== columns.join(",")) return fail(`Columns differ from the existing file (${head}): cannot append. Choose another file or drop \`append\`.`);
        await fs.appendFile(out, toCsv(columns, rows).split("\n").slice(1).join("\n"));
        total += existing.trim().split(/\r?\n/).length - 1;
      } else await fs.writeFile(out, toCsv(columns, rows));
    } else await fs.writeFile(out, toCsv(columns, rows));

    const first = rows[0];
    const last = rows[rows.length - 1];
    const stamp = (r: Row) => (cols.time ? String(r[cols.time]) : "?");
    const lines = [
      `Written ${displayPath(ctx.workspace, out)}: ${rows.length} row${rows.length > 1 ? "s" : ""}${args.append ? ` (${total} in total)` : ""}, columns: ${columns.join(", ")}.`,
      cols.time ? `Period: ${stamp(first)} → ${stamp(last)}.` : "No time column recognised.",
      cols.close ? `Price recognised: ${cols.close}${cols.open ? ` (full OHLC${cols.volume ? "V" : ""})` : ""}. Last: ${String(last[cols.close])}.` : "",
      `First row: ${JSON.stringify(first)}`,
    ].filter(Boolean);
    return ok(lines.join("\n"));
  },
};
