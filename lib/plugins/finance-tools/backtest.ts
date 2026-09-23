import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { Tool, ToolContext, ToolResult } from "@/lib/tools/types";
import { errorText, fail } from "@/lib/tools/types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "@/lib/tools/paths";
import { parseCsv, toMillis } from "./csv";
import { buildChartSvg } from "./svg";

/* ---------------------------------------------------------------------------
   Backtest: the same engine for every strategy.

   The agent writes a tiny Python file — `signal(df)` returning -1/0/1,
   `stop_distance(df)` optionally — and our engine (py/backtest.py) does the
   rest: execution at the next candle, fees, slippage, funding, sizing by
   risk, in/out-of-sample split, metrics per period and per year, buy-and-
   hold reference, equity curve. One tested implementation, instead of a new
   script every time. Requires Python 3 with pandas and numpy.
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

/* The engine lives in the package, not where the process runs: the MCP
   server is launched in the agent's workspace. */
const engineOf = (projectRoot: string) => path.join(projectRoot, "lib", "plugins", "finance-tools", "py", "backtest.py");
const TIMEOUT = 10 * 60_000;

export const backtestTool: Tool<Args> = {
  name: "Backtest",
  policy: { gated: true, subagent: true },
  description:
    "Backtests a strategy with BytNode-AI's standard engine (execution at the next candle's open, fees + slippage per side, funding if the column exists, sizing by risk when a stop is given, in-sample / out-of-sample split, metrics per period and per year, buy-and-hold reference, equity curve). " +
    "`data`: an OHLCV CSV of the workspace (SaveMarketData). `strategy`: a Python file of the workspace defining `signal(df, **params) -> pd.Series` with values -1 / 0 / 1, computed with the data ≤ t (causal rolling, never center=True), and optionally `stop_distance(df, **params) -> pd.Series` (distance to the stop in price, e.g. 2×ATR). " +
    "Writes out/backtests/<name>/{metrics.json, equity.csv, trades.csv, equity.png} and returns the metrics table + the curve. Do not rewrite an engine in Bash: use this one, then `validation-statistique` to judge.",
  parameters: {
    type: "object",
    properties: {
      data: { type: "string", description: "OHLCV CSV, relative to the workspace." },
      strategy: { type: "string", description: "The strategy's Python file, relative to the workspace." },
      name: { type: "string", description: "The experiment's name (output folder). Default: the strategy file's name." },
      params: { type: "object", additionalProperties: true, description: "Parameters passed to signal()/stop_distance()." },
      fee: { type: "number", description: "Fee per side, as a fraction. Default 0.0006." },
      slippage: { type: "number", description: "Slippage per side, as a fraction. Default 0.0005." },
      risk: { type: "number", description: "Fraction of the capital risked per position (with a stop). Default 0.01." },
      max_leverage: { type: "number", description: "Maximum notional leverage. Default 3." },
      periods_per_year: { type: "integer", description: "365 (daily crypto), 2190 (4 h), 8760 (1 h)… Default 365." },
      split: { type: "number", minimum: 0.1, maximum: 0.95, description: "In-sample share. Default 0.7." },
    },
    required: ["data", "strategy"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    return runBacktest(args, ctx);
  },
};

async function runBacktest(args: Args, ctx: ToolContext): Promise<ToolResult> {
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
      return fail(`File not found: ${displayPath(ctx.workspace, f)}`);
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
  if (!python) return fail("Python 3 not found (python / python3 / py). The backtest requires Python with pandas and numpy.");
  const engine = engineOf(ctx.projectRoot);
  try {
    await fs.access(engine);
  } catch {
    return fail(`Engine not found: ${engine}. The BytNode-AI installation is incomplete.`);
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
    if (/No module named/.test(err)) return fail(`A Python module is missing: ${err}\nInstall it (pip install pandas numpy) and run again.`);
    return fail(`The engine returned nothing (code ${run.code}).\n${err}`);
  }
  if (!report.ok) return fail(`Backtest impossible: ${report.error}\n${run.stderr.trim().slice(-1500)}`);

  /* The equity curve, with buy-and-hold as the reference. */
  const attachments: ToolResult["attachments"] = [];
  try {
    const eq = parseCsv(await fs.readFile(path.join(outDir, "equity.csv"), "utf8"));
    const rows = eq.rows.filter((r) => typeof r.equity === "number");
    const c0 = typeof rows[0]?.close === "number" ? (rows[0].close as number) : null;
    const svg = buildChartSvg({
      title: `Equity — ${path.basename(outDir)} (× ${((rows[rows.length - 1]?.equity as number) ?? 1).toFixed(3)})`,
      type: "line",
      series: rows.map((r, i) => ({ time: toMillis(r.time) ?? i, close: r.equity as number })),
      overlays: c0 ? [{ name: "buy and hold", values: rows.map((r) => (typeof r.close === "number" ? (r.close as number) / c0 : null)), color: "#8b949e" }] : [],
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
    /* no curve: the table is enough */
  }

  const text = [
    `Backtest ${path.basename(outDir)}: ${report.rows} candles, ${report.start} → ${report.end}${report.split_at ? `, out of sample from ${report.split_at}` : ""}. ${report.trades} round trip${(report.trades ?? 0) > 1 ? "s" : ""}.`,
    `Fees ${cfg.fee} + slippage ${cfg.slippage} per side, risk ${cfg.risk}, max leverage ${cfg.max_leverage}, ${cfg.periods_per_year} periods/year. Parameters: ${JSON.stringify(cfg.params)}.`,
    "",
    metricsTable(report.metrics ?? {}),
    "",
    `Files: ${displayPath(ctx.workspace, outDir)}/{metrics.json, equity.csv, trades.csv, equity.png}.`,
    "Before concluding: out of sample vs in sample, number of trades, sensitivity to the parameters (run again at ±20 %), multiple testing — see the validation-statistique skill.",
  ].join("\n");
  return { ok: true, output: text, ...(attachments.length ? { attachments } : {}) };
}

const ORDER = ["all", "in_sample", "out_of_sample", "buy_and_hold"];
const COLS: Array<[string, string, (v: number) => string]> = [
  ["total_return", "Return", (v) => `${(v * 100).toFixed(1)} %`],
  ["cagr", "Annualised", (v) => `${(v * 100).toFixed(1)} %`],
  ["volatility", "Vol.", (v) => `${(v * 100).toFixed(1)} %`],
  ["sharpe", "Sharpe", (v) => v.toFixed(2)],
  ["sortino", "Sortino", (v) => v.toFixed(2)],
  ["max_drawdown", "Max DD", (v) => `${(v * 100).toFixed(1)} %`],
  ["calmar", "Calmar", (v) => v.toFixed(2)],
  ["exposure", "Exposure", (v) => `${(v * 100).toFixed(0)} %`],
  ["trades", "Changes", (v) => String(v)],
  ["longest_losing_streak", "Losing streak", (v) => String(v)],
];

function metricsTable(m: Record<string, Metrics>): string {
  const keys = [...ORDER.filter((k) => k in m), ...Object.keys(m).filter((k) => !ORDER.includes(k)).sort()];
  const head = `| Period | ${COLS.map((c) => c[1]).join(" | ")} |`;
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
