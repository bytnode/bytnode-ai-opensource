import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { Tool } from "@/lib/tools/types";
import { errorText, fail } from "@/lib/tools/types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "@/lib/tools/paths";
import { detectColumns, parseCsv, toMillis, type Row } from "./csv";
import { buildChartSvg, type Candle, type ChartSpec } from "./svg";

/* ---------------------------------------------------------------------------
   Chart: a market chart as a PNG, in the workspace.

   From a CSV (SaveMarketData's, or any series with a time column and a
   price): candles or a line, volume, overlaid columns (indicators computed
   and added to the CSV), entry/exit markers, levels. The image is attached
   to the result: the model sees it, and the thread shows it.
--------------------------------------------------------------------------- */

type Args = {
  data: string;
  output?: string;
  title?: string;
  type?: "candles" | "line";
  overlays?: string[];
  markers?: Array<{ time: string | number; price: number; label?: string; kind?: "buy" | "sell" | "note" }>;
  hlines?: Array<{ price: number; label?: string }>;
  last?: number;
  width?: number;
  height?: number;
};

export const chartTool: Tool<Args> = {
  name: "Chart",
  policy: { gated: false, subagent: true },
  description:
    "Draws a market chart (PNG) from a CSV of the workspace — candles or a line, volume, overlaid indicators, markers and levels — and shows it to the user. " +
    "`data`: the CSV (time/open/high/low/close/volume columns recognised by their usual names; a time+price series is enough for a line). " +
    "`overlays`: CSV columns to draw on top (e.g. a moving average you computed and added to the file). " +
    "`markers`: entries/exits to point at ({time, price, label, kind: buy|sell|note}). `hlines`: horizontal levels. " +
    "`last`: keep only the last N rows. Writes `output` (default: out/charts/<name>.png). You receive the image back: check it before commenting on it.",
  parameters: {
    type: "object",
    properties: {
      data: { type: "string", description: "The CSV's path, relative to the workspace." },
      output: { type: "string", description: "The PNG to write. Default: out/charts/<CSV name>.png" },
      title: { type: "string" },
      type: { type: "string", enum: ["candles", "line"], description: "Default: candles if the CSV has open/high/low, otherwise line." },
      overlays: { type: "array", items: { type: "string" }, description: "CSV columns to overlay (lines)." },
      markers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            time: { type: ["string", "number"] },
            price: { type: "number" },
            label: { type: "string" },
            kind: { type: "string", enum: ["buy", "sell", "note"] },
          },
          required: ["time", "price"],
        },
      },
      hlines: { type: "array", items: { type: "object", properties: { price: { type: "number" }, label: { type: "string" } }, required: ["price"] } },
      last: { type: "integer", minimum: 2, description: "Only draw the last N rows." },
      width: { type: "integer", minimum: 320, maximum: 2400 },
      height: { type: "integer", minimum: 200, maximum: 1600 },
    },
    required: ["data"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let src: string;
    let out: string;
    try {
      src = resolvePath(ctx.workspace, args.data, ctx.scope);
      const base = path.basename(args.data).replace(/\.[^.]+$/, "");
      out = resolvePath(ctx.workspace, args.output ?? `out/charts/${base}.png`, ctx.scope);
    } catch (e) {
      return fail(e instanceof OutsideWorkspaceError ? e.message : errorText(e));
    }
    let table;
    try {
      table = parseCsv(await fs.readFile(src, "utf8"));
    } catch (e) {
      return fail(`Cannot read ${displayPath(ctx.workspace, src)}: ${errorText(e)}`);
    }
    const cols = detectColumns(table.columns);
    if (!cols.close) return fail(`No price column recognised in ${table.columns.join(", ")}. Expected: close / price / value (and time / date).`);
    let rows = table.rows;
    if (args.last && rows.length > args.last) rows = rows.slice(-args.last);
    if (rows.length > 3000) rows = rows.slice(-3000);
    const num = (r: Row, c?: string) => (c !== undefined && typeof r[c] === "number" ? (r[c] as number) : undefined);
    const series: Candle[] = rows
      .map((r, i) => ({
        time: (cols.time ? toMillis(r[cols.time]) : null) ?? i,
        open: num(r, cols.open),
        high: num(r, cols.high),
        low: num(r, cols.low),
        close: num(r, cols.close) as number,
        volume: num(r, cols.volume),
      }))
      .filter((c) => Number.isFinite(c.close));
    if (series.length < 2) return fail("Fewer than two usable points.");
    const hasOhlc = series.every((c) => c.open !== undefined && c.high !== undefined && c.low !== undefined);
    const missing = (args.overlays ?? []).filter((o) => !table.columns.includes(o));
    if (missing.length) return fail(`Columns missing from the CSV: ${missing.join(", ")}. Available columns: ${table.columns.join(", ")}.`);
    const spec: ChartSpec = {
      title: args.title ?? path.basename(args.data),
      type: args.type ?? (hasOhlc ? "candles" : "line"),
      series,
      overlays: (args.overlays ?? []).map((name) => ({ name, values: rows.map((r) => (typeof r[name] === "number" ? (r[name] as number) : null)) })),
      markers: (args.markers ?? []).map((m) => ({ ...m, time: toMillis(m.time) ?? 0 })),
      hlines: args.hlines ?? [],
      width: args.width ?? 1100,
      height: args.height ?? 520,
    };
    const svg = buildChartSvg(spec);
    let png: Buffer;
    try {
      png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: spec.width } }).render().asPng());
    } catch (e) {
      return fail(`Rendering failed: ${errorText(e)}`);
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, png);
    const rel = displayPath(ctx.workspace, out);
    const first = series[0];
    const last = series[series.length - 1];
    const text = [
      `Chart written: ${rel} (${series.length} points, ${spec.type}${spec.overlays.length ? `, overlays: ${spec.overlays.map((o) => o.name).join(", ")}` : ""}).`,
      `Last: ${last.close}${first.close ? ` (${(((last.close - first.close) / first.close) * 100).toFixed(2)} % over the window)` : ""}.`,
    ].join("\n");
    return { ok: true, output: text, attachments: [{ type: "image", name: rel, dataUrl: `data:image/png;base64,${png.toString("base64")}`, path: out }] };
  },
};
