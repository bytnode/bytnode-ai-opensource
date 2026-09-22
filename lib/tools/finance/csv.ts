/* ---------------------------------------------------------------------------
   Tables: reading and writing CSV, finding the rows in an arbitrary JSON
   response, recognising the columns of a price series.

   Pure — no disk, no network — so it can be tested thoroughly: it is the
   layer SaveMarketData, Chart and Backtest are built on.
--------------------------------------------------------------------------- */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Table = { columns: string[]; rows: Row[] };

export function coerceNumber(v: string): Cell {
  const t = v.trim();
  if (t === "") return "";
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return v;
}

export function parseCsv(text: string): Table {
  const lines = splitLines(text);
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = splitFields(lines[0]).map((c) => c.trim());
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const fields = splitFields(line);
    const row: Row = {};
    columns.forEach((c, i) => {
      row[c] = coerceNumber(fields[i] ?? "");
    });
    rows.push(row);
  }
  return { columns, rows };
}

function splitLines(text: string): string[] {
  /* A newline inside quotes does not break the line. */
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function splitFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const quote = (v: Cell) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns: string[], rows: Row[]): string {
  const head = columns.join(",");
  const body = rows.map((r) => columns.map((c) => quote(r[c] ?? "")).join(","));
  return `${head}\n${body.join("\n")}\n`;
}

/* --- Trouver les lignes dans une reponse JSON ---------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const OHLCV_POSITIONAL = ["time", "open", "high", "low", "close", "volume"];

/** Le tableau de lignes que contient une reponse, ou qu'il faut deviner :
    un tableau d'objets a la racine ou sous une cle ; un tableau de tableaux
    avec des colonnes declarees ; ou la forme positionnelle des echanges
    (`[time, open, high, low, close, volume]`). */
export function rowsOf(data: unknown, depth = 0): Row[] | null {
  if (depth > 4) return null;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    if (data.every(isRecord)) return data.map((r) => flatten(r));
    if (data.every((x) => Array.isArray(x) && x.every(isCell))) {
      const width = (data[0] as unknown[]).length;
      const names = width <= OHLCV_POSITIONAL.length ? OHLCV_POSITIONAL.slice(0, width) : Array.from({ length: width }, (_, i) => `c${i}`);
      return (data as Cell[][]).map((arr) => Object.fromEntries(names.map((n, i) => [n, arr[i] ?? null])));
    }
    return null;
  }
  if (!isRecord(data)) return null;
  /* Colonnes + valeurs separees. */
  const cols = data.columns ?? data.headers ?? data.fields;
  const vals = data.values ?? data.data ?? data.rows;
  if (Array.isArray(cols) && cols.every((c) => typeof c === "string") && Array.isArray(vals) && vals.every((v) => Array.isArray(v))) {
    return (vals as Cell[][]).map((arr) => Object.fromEntries((cols as string[]).map((n, i) => [n, arr[i] ?? null])));
  }
  /* Sinon, le plus grand tableau de lignes trouve sous une cle (les noms
     usuels departagent) : une reponse porte souvent des metadonnees a cote
     des donnees, et ce sont les donnees qu'on veut. */
  let best: Row[] | null = null;
  let bestScore = -1;
  for (const k of Object.keys(data)) {
    const found = rowsOf(data[k], depth + 1);
    if (!found) continue;
    const score = found.length * 10 + (PREFERRED.length - rank(k));
    if (score > bestScore) {
      best = found;
      bestScore = score;
    }
  }
  return best;
}

const PREFERRED = ["data", "rows", "candles", "ohlcv", "history", "result", "results", "items", "values", "series"];
const rank = (k: string) => {
  const i = PREFERRED.indexOf(k.toLowerCase());
  return i === -1 ? PREFERRED.length : i;
};

const isCell = (v: unknown): v is Cell => v === null || ["string", "number", "boolean"].includes(typeof v);

/** Un objet en une ligne : les sous-objets sont aplatis (`a.b`), les
    tableaux serialises. */
function flatten(obj: Record<string, unknown>, prefix = ""): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isCell(v)) row[key] = v;
    else if (isRecord(v)) Object.assign(row, flatten(v, key));
    else row[key] = JSON.stringify(v);
  }
  return row;
}

/* --- Reconnaitre les colonnes d'une serie -------------------------------- */

export type PriceColumns = { time?: string; open?: string; high?: string; low?: string; close?: string; volume?: string };

const NAMES: Record<keyof PriceColumns, string[]> = {
  time: ["time", "timestamp", "date", "datetime", "t", "ts", "open_time", "opentime", "period", "x"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "price", "last", "value", "y", "equity"],
  volume: ["volume", "vol", "v", "quote_volume", "base_volume"],
};

export function detectColumns(columns: string[]): PriceColumns {
  const lower = columns.map((c) => c.toLowerCase());
  const find = (cands: string[]) => {
    for (const c of cands) {
      const i = lower.indexOf(c);
      if (i >= 0) return columns[i];
    }
    for (const c of cands) {
      const i = lower.findIndex((x) => x.endsWith(`.${c}`) || x.endsWith(`_${c}`));
      if (i >= 0) return columns[i];
    }
    return undefined;
  };
  const out: PriceColumns = {};
  for (const k of Object.keys(NAMES) as (keyof PriceColumns)[]) {
    const c = find(NAMES[k]);
    if (c) out[k] = c;
  }
  return out;
}

/** Une valeur de temps en millisecondes Unix, quelle que soit sa forme
    (secondes, millisecondes, ISO). */
export function toMillis(v: Cell): number | null {
  if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") {
    const n = Number(v);
    if (v.trim() && Number.isFinite(n)) return toMillis(n);
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}
