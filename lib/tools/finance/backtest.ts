import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { Tool, ToolContext, ToolResult } from "../types";
import { errorText, fail } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { parseCsv, toMillis } from "./csv";
import { buildChartSvg } from "./svg";

/* ---------------------------------------------------------------------------
   Backtest : le meme moteur pour toutes les strategies.

   L'agent ecrit un fichier Python minuscule — `signal(df)` qui rend -1/0/1,
   `stop_distance(df)` en option — et c'est notre moteur (py/backtest.py)
   qui fait le reste : execution a la bougie suivante, frais, slippage,
   funding, taille par le risque, decoupage in/out-of-sample, metriques par
   periode et par annee, reference acheter-et-garder, courbe de capital.
   Une seule implementation, testee, au lieu d'un script neuf a chaque
   fois. Exige Python 3 avec pandas et numpy.
--------------------------------------------------------------------------- */

type Args = {
  data: string;
  strategy: string;
  name?: string;
  params?: Record<string, unknown>;
  fee?: number;
  slippage?: number;
  risk?: number;
  max_leverage?: number;
  periods_per_year?: number;
  split?: number;
};

type Metrics = Record<string, number | null>;
type Report = {
  ok: boolean;
  error?: string;
  rows?: number;
  start?: string;
  end?: string;
  split_at?: string | null;
  trades?: number;
  metrics?: Record<string, Metrics>;
};

/* Le moteur vit dans le projet, pas la ou le processus tourne : le serveur
   MCP est lance dans le dossier de travail de l'agent. */
const engineOf = (projectRoot: string) => path.join(projectRoot, "lib", "tools", "finance", "py", "backtest.py");
const TIMEOUT = 10 * 60_000;

export const backtestTool: Tool<Args> = {
  name: "Backtest",
  policy: { gated: true, subagent: true },
  description:
    "Backteste une stratégie avec le moteur standard de BytNode-AI (exécution à l'ouverture de la bougie suivante, frais + slippage par côté, funding si la colonne existe, taille par le risque quand un stop est donné, découpage in-sample / out-of-sample, métriques par période et par année, référence acheter-et-garder, courbe de capital). " +
    "`data` : un CSV OHLCV du dossier de travail (SaveMarketData). `strategy` : un fichier Python du dossier de travail qui définit `signal(df, **params) -> pd.Series` à valeurs -1 / 0 / 1, calculées avec les données ≤ t (rolling causal, jamais center=True), et optionnellement `stop_distance(df, **params) -> pd.Series` (distance au stop en prix, ex. 2×ATR). " +
    "Écrit out/backtests/<name>/{metrics.json, equity.csv, trades.csv, equity.png} et te rend le tableau des métriques + la courbe. Ne réécris pas de moteur en Bash : utilise celui-ci, puis `validation-statistique` pour juger.",
  parameters: {
    type: "object",
    properties: {
      data: { type: "string", description: "CSV OHLCV, relatif au dossier de travail." },
      strategy: { type: "string", description: "Fichier Python de la stratégie, relatif au dossier de travail." },
      name: { type: "string", description: "Nom de l'expérience (dossier de sortie). Défaut : nom du fichier de stratégie." },
      params: { type: "object", additionalProperties: true, description: "Paramètres passés à signal()/stop_distance()." },
      fee: { type: "number", description: "Frais par côté, fraction. Défaut 0.0006." },
      slippage: { type: "number", description: "Slippage par côté, fraction. Défaut 0.0005." },
      risk: { type: "number", description: "Fraction du capital risquée par position (avec stop). Défaut 0.01." },
      max_leverage: { type: "number", description: "Levier notionnel maximal. Défaut 3." },
      periods_per_year: { type: "integer", description: "365 (journalier crypto), 2190 (4 h), 8760 (1 h)… Défaut 365." },
      split: { type: "number", minimum: 0.1, maximum: 0.95, description: "Part in-sample. Défaut 0.7." },
    },
    required: ["data", "strategy"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    return runBacktest(args, ctx);
  },
};

export async function runBacktest(args: Args, ctx: ToolContext): Promise<ToolResult> {
  let data: string;
  let strategy: string;
  let outDir: string;
  try {
    data = resolvePath(ctx.workspace, args.data, ctx.scope);
    strategy = resolvePath(ctx.workspace, args.strategy, ctx.scope);
    const name = (args.name ?? path.basename(args.strategy).replace(/\.py$/i, "")).replace(/[^\w.-]/g, "_");
    outDir = resolvePath(ctx.workspace, `out/backtests/${name}`, ctx.scope);
  } catch (e) {
    return fail(e instanceof OutsideWorkspaceError ? e.message : errorText(e));
  }
  for (const f of [data, strategy]) {
    try {
      await fs.access(f);
    } catch {
      return fail(`Fichier introuvable : ${displayPath(ctx.workspace, f)}`);
    }
  }
  await fs.mkdir(outDir, { recursive: true });
  const cfgPath = path.join(outDir, "config.json");
  const cfg = {
    data,
    strategy,
    params: args.params ?? {},
    fee: args.fee ?? 0.0006,
    slippage: args.slippage ?? 0.0005,
    risk: args.risk ?? 0.01,
    max_leverage: args.max_leverage ?? 3,
    periods_per_year: args.periods_per_year ?? 365,
    split: args.split ?? 0.7,
    out_dir: outDir,
  };
  await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));

  const python = await findPython();
  if (!python) return fail("Python 3 introuvable (python / python3 / py). Le backtest exige Python avec pandas et numpy.");
  const engine = engineOf(ctx.projectRoot);
  try {
    await fs.access(engine);
  } catch {
    return fail(`Moteur introuvable : ${engine}. L'installation de BytNode-AI est incomplète.`);
  }
  const run = await exec(python, [engine, cfgPath], ctx.workspace, ctx.signal);
  const jsonLine = run.stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  let report: Report | null = null;
  try {
    report = jsonLine ? (JSON.parse(jsonLine) as Report) : null;
  } catch {
    report = null;
  }
  if (!report) {
    const err = (run.stderr || run.stdout).trim().slice(-3000);
    if (/No module named/.test(err)) return fail(`Il manque un module Python : ${err}\nInstalle-le (pip install pandas numpy) puis relance.`);
    return fail(`Le moteur n'a rien rendu (code ${run.code}).\n${err}`);
  }
  if (!report.ok) return fail(`Backtest impossible : ${report.error}\n${run.stderr.trim().slice(-1500)}`);

  /* La courbe de capital, avec acheter-et-garder en reference. */
  const attachments: ToolResult["attachments"] = [];
  try {
    const eq = parseCsv(await fs.readFile(path.join(outDir, "equity.csv"), "utf8"));
    const rows = eq.rows.filter((r) => typeof r.equity === "number");
    const c0 = typeof rows[0]?.close === "number" ? (rows[0].close as number) : null;
    const svg = buildChartSvg({
      title: `Capital — ${path.basename(outDir)} (× ${((rows[rows.length - 1]?.equity as number) ?? 1).toFixed(3)})`,
      type: "line",
      series: rows.map((r, i) => ({ time: toMillis(r.time) ?? i, close: r.equity as number })),
      overlays: c0 ? [{ name: "acheter-et-garder", values: rows.map((r) => (typeof r.close === "number" ? (r.close as number) / c0 : null)), color: "#8b949e" }] : [],
      markers: [],
      hlines: [{ price: 1, label: "" }],
      width: 1100,
      height: 460,
    });
    const png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 1100 } }).render().asPng());
    const pngPath = path.join(outDir, "equity.png");
    await fs.writeFile(pngPath, png);
    attachments.push({ type: "image", name: displayPath(ctx.workspace, pngPath), dataUrl: `data:image/png;base64,${png.toString("base64")}`, path: pngPath });
  } catch {
    /* pas de courbe : le tableau suffit */
  }

  const text = [
    `Backtest ${path.basename(outDir)} : ${report.rows} bougies, ${report.start} → ${report.end}${report.split_at ? `, hors échantillon à partir de ${report.split_at}` : ""}. ${report.trades} trade${(report.trades ?? 0) > 1 ? "s" : ""} aller-retour.`,
    `Frais ${cfg.fee} + slippage ${cfg.slippage} par côté, risque ${cfg.risk}, levier max ${cfg.max_leverage}, ${cfg.periods_per_year} périodes/an. Paramètres : ${JSON.stringify(cfg.params)}.`,
    "",
    metricsTable(report.metrics ?? {}),
    "",
    `Fichiers : ${displayPath(ctx.workspace, outDir)}/{metrics.json, equity.csv, trades.csv, equity.png}.`,
    "Avant de conclure : hors échantillon vs in-sample, nombre de trades, sensibilité aux paramètres (relance avec ±20 %), tests multiples — voir la compétence validation-statistique.",
  ].join("\n");
  return { ok: true, output: text, ...(attachments.length ? { attachments } : {}) };
}

const ORDER = ["all", "in_sample", "out_of_sample", "buy_and_hold"];
const COLS: Array<[string, string, (v: number) => string]> = [
  ["total_return", "Rendement", (v) => `${(v * 100).toFixed(1)} %`],
  ["cagr", "Annualisé", (v) => `${(v * 100).toFixed(1)} %`],
  ["volatility", "Vol.", (v) => `${(v * 100).toFixed(1)} %`],
  ["sharpe", "Sharpe", (v) => v.toFixed(2)],
  ["sortino", "Sortino", (v) => v.toFixed(2)],
  ["max_drawdown", "DD max", (v) => `${(v * 100).toFixed(1)} %`],
  ["calmar", "Calmar", (v) => v.toFixed(2)],
  ["exposure", "Exposition", (v) => `${(v * 100).toFixed(0)} %`],
  ["trades", "Changements", (v) => String(v)],
  ["longest_losing_streak", "Série pertes", (v) => String(v)],
];

function metricsTable(m: Record<string, Metrics>): string {
  const keys = [...ORDER.filter((k) => k in m), ...Object.keys(m).filter((k) => !ORDER.includes(k)).sort()];
  const head = `| Période | ${COLS.map((c) => c[1]).join(" | ")} |`;
  const sep = `|---|${COLS.map(() => "---:").join("|")}|`;
  const rows = keys.map((k) => {
    const cells = COLS.map(([id, , fmt]) => {
      const v = m[k]?.[id];
      return typeof v === "number" ? fmt(v) : "—";
    });
    return `| ${k.replace(/_/g, " ")} | ${cells.join(" | ")} |`;
  });
  return [head, sep, ...rows].join("\n");
}

let pythonCmd: string | null | undefined;
async function findPython(): Promise<string | null> {
  if (pythonCmd !== undefined) return pythonCmd;
  for (const cmd of ["python", "python3", "py"]) {
    const r = await exec(cmd, ["-c", "import pandas, numpy; print('ok')"], process.cwd(), undefined, 30_000).catch(() => null);
    if (r && r.code === 0 && /ok/.test(r.stdout)) {
      pythonCmd = cmd;
      return cmd;
    }
  }
  pythonCmd = null;
  return null;
}

function exec(cmd: string, args: string[], cwd: string, signal?: AbortSignal, timeoutMs = TIMEOUT): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}
