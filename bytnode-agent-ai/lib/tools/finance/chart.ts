import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { Tool, ToolContext, ToolResult } from "../types";
import { errorText, fail } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { detectColumns, parseCsv, toMillis, type Row } from "./csv";
import { buildChartSvg, type Candle, type ChartSpec } from "./svg";

/* ---------------------------------------------------------------------------
   Chart : un graphique de marche en PNG, dans le dossier de travail.

   Depuis un CSV (celui de SaveMarketData, ou n'importe quelle serie avec
   une colonne de temps et un prix) : bougies ou ligne, volume, colonnes
   superposees (indicateurs calcules et ajoutes au CSV), marqueurs
   d'entree/sortie, niveaux. L'image est jointe au resultat : le modele la
   voit, et le fil l'affiche.
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
  description:
    "Trace un graphique de marché (PNG) depuis un CSV du dossier de travail — bougies ou ligne, volume, indicateurs superposés, marqueurs et niveaux — et l'affiche à l'utilisateur. " +
    "`data` : le CSV (colonnes time/open/high/low/close/volume reconnues par leurs noms usuels ; une série time+prix suffit pour une ligne). " +
    "`overlays` : des colonnes du CSV à tracer par-dessus (ex. une moyenne mobile que tu as calculée et ajoutée au fichier). " +
    "`markers` : entrées/sorties à pointer ({time, price, label, kind: buy|sell|note}). `hlines` : niveaux horizontaux. " +
    "`last` : ne garder que les N dernières lignes. Écrit `output` (défaut : out/charts/<nom>.png). Tu reçois l'image en retour : vérifie-la avant de la commenter.",
  parameters: {
    type: "object",
    properties: {
      data: { type: "string", description: "Chemin du CSV, relatif au dossier de travail." },
      output: { type: "string", description: "Chemin du PNG à écrire. Défaut : out/charts/<nom du CSV>.png" },
      title: { type: "string" },
      type: { type: "string", enum: ["candles", "line"], description: "Défaut : candles si le CSV a open/high/low, sinon line." },
      overlays: { type: "array", items: { type: "string" }, description: "Colonnes du CSV à superposer (lignes)." },
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
      last: { type: "integer", minimum: 2, description: "Ne tracer que les N dernières lignes." },
      width: { type: "integer", minimum: 320, maximum: 2400 },
      height: { type: "integer", minimum: 200, maximum: 1600 },
    },
    required: ["data"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    return renderChart(args, ctx);
  },
};

export async function renderChart(args: Args, ctx: ToolContext): Promise<ToolResult> {
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
    return fail(`Impossible de lire ${displayPath(ctx.workspace, src)} : ${errorText(e)}`);
  }
  const cols = detectColumns(table.columns);
  if (!cols.close) return fail(`Aucune colonne de prix reconnue dans ${table.columns.join(", ")}. Attendu : close / price / value (et time / date).`);
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
  if (series.length < 2) return fail("Moins de deux points exploitables.");
  const hasOhlc = series.every((c) => c.open !== undefined && c.high !== undefined && c.low !== undefined);
  const missing = (args.overlays ?? []).filter((o) => !table.columns.includes(o));
  if (missing.length) return fail(`Colonnes absentes du CSV : ${missing.join(", ")}. Colonnes disponibles : ${table.columns.join(", ")}.`);
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
    return fail(`Rendu impossible : ${errorText(e)}`);
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, png);
  const rel = displayPath(ctx.workspace, out);
  const first = series[0];
  const last = series[series.length - 1];
  const text = [
    `Graphique écrit : ${rel} (${series.length} points, ${spec.type}${spec.overlays.length ? `, overlays : ${spec.overlays.map((o) => o.name).join(", ")}` : ""}).`,
    `Dernier : ${last.close}${first.close ? ` (${(((last.close - first.close) / first.close) * 100).toFixed(2)} % sur la fenêtre)` : ""}.`,
  ].join("\n");
  return { ok: true, output: text, attachments: [{ type: "image", name: rel, dataUrl: `data:image/png;base64,${png.toString("base64")}`, path: out }] };
}
