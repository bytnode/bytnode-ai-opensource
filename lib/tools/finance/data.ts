import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import { bytnodeTools, callBytnodeTool } from "@/lib/mcp/bytnode";
import { detectColumns, rowsOf, toCsv, toMillis, type Row } from "./csv";

/* ---------------------------------------------------------------------------
   SaveMarketData : des donnees BytNode en fichier, sans passer par le modele.

   Appelle un outil BytNode (`get_history`, `get_market_data`…) avec ses
   arguments, trouve le tableau dans la reponse, l'ecrit en CSV dans le
   dossier de travail et ne rend au modele qu'un resume : colonnes, nombre
   de lignes, premiere et derniere date. Deux mille bougies ne transitent
   plus par le contexte — elles sont sur le disque, pretes pour Chart,
   Backtest ou pandas.
--------------------------------------------------------------------------- */

type Args = { tool: string; args?: Record<string, unknown>; output: string; append?: boolean };

const MAX_ROWS = 200_000;

export const saveMarketDataTool: Tool<Args> = {
  name: "SaveMarketData",
  description:
    "Interroge un outil de données BytNode (`get_history`, `get_market_data`, `get_market_indicators`…) et enregistre le tableau obtenu en CSV dans le dossier de travail, sans le faire passer par la conversation. " +
    "Utilise-le dès qu'il y a plus de quelques dizaines de lignes (historique de bougies, séries d'indicateurs) : tu reçois un résumé (colonnes, nombre de lignes, période) et le fichier est prêt pour Chart, Backtest ou un script pandas. " +
    "`tool` et `args` sont exactement ceux que tu passerais à l'outil BytNode (regarde `get_system_info` pour les paramètres). `append: true` ajoute à un CSV existant (mêmes colonnes) au lieu de le remplacer.",
  parameters: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Nom de l'outil BytNode à appeler." },
      args: { type: "object", description: "Ses arguments.", additionalProperties: true },
      output: { type: "string", description: "Chemin du CSV à écrire, relatif au dossier de travail (ex. data/btc_4h.csv)." },
      append: { type: "boolean", description: "Ajouter à la fin du fichier au lieu de le remplacer." },
    },
    required: ["tool", "output"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const key = ctx.bytnodeKey?.trim();
    if (!key) return fail("Aucune clé BytNode : la source de données n'est pas connectée. Dis-le à l'utilisateur (page Authentification).");
    let out: string;
    try {
      out = resolvePath(ctx.workspace, args.output, ctx.scope);
    } catch (e) {
      return fail(e instanceof OutsideWorkspaceError ? e.message : errorText(e));
    }
    if (!/\.csv$/i.test(out)) return fail("Le fichier de sortie doit être un .csv.");
    const infos = await bytnodeTools(key).catch(() => []);
    if (infos.length && !infos.some((t) => t.name === args.tool)) {
      return fail(`Outil BytNode inconnu : ${args.tool}. Disponibles : ${infos.map((t) => t.name).join(", ")}.`);
    }
    const res = await callBytnodeTool(key, args.tool, args.args ?? {}, ctx.signal);
    if (!res.ok) return res;
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.output);
    } catch {
      /* pas du JSON : peut-etre du CSV, ou du texte */
      if (/^[^\n]+,[^\n]+\n/.test(res.output)) {
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(out, res.output);
        return ok(`BytNode a rendu du CSV ; écrit tel quel dans ${displayPath(ctx.workspace, out)} (${res.output.split("\n").length - 1} lignes).`);
      }
      return fail(`La réponse de ${args.tool} n'est pas un tableau (texte libre) :\n${res.output.slice(0, 1500)}`);
    }
    let rows = rowsOf(parsed);
    if (!rows || rows.length === 0) return fail(`Aucun tableau trouvé dans la réponse de ${args.tool} :\n${JSON.stringify(parsed).slice(0, 1500)}`);
    if (rows.length > MAX_ROWS) rows = rows.slice(-MAX_ROWS);

    const columns = Array.from(rows.reduce((set, r) => (Object.keys(r).forEach((k) => set.add(k)), set), new Set<string>()));
    const cols = detectColumns(columns);
    /* Ordre chronologique, si on sait lire le temps. */
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
        /* pas encore de fichier */
      }
      if (existing.trim()) {
        const head = existing.split(/\r?\n/)[0];
        if (head !== columns.join(",")) return fail(`Colonnes différentes du fichier existant (${head}) : impossible d'ajouter. Choisis un autre fichier ou retire \`append\`.`);
        await fs.appendFile(out, toCsv(columns, rows).split("\n").slice(1).join("\n"));
        total += existing.trim().split(/\r?\n/).length - 1;
      } else await fs.writeFile(out, toCsv(columns, rows));
    } else await fs.writeFile(out, toCsv(columns, rows));

    const first = rows[0];
    const last = rows[rows.length - 1];
    const stamp = (r: Row) => (cols.time ? String(r[cols.time]) : "?");
    const lines = [
      `Écrit ${displayPath(ctx.workspace, out)} : ${rows.length} ligne${rows.length > 1 ? "s" : ""}${args.append ? ` (${total} au total)` : ""}, colonnes : ${columns.join(", ")}.`,
      cols.time ? `Période : ${stamp(first)} → ${stamp(last)}.` : "Aucune colonne de temps reconnue.",
      cols.close ? `Prix reconnu : ${cols.close}${cols.open ? ` (OHLC${cols.volume ? "V" : ""} complet)` : ""}. Dernier : ${String(last[cols.close])}.` : "",
      `Première ligne : ${JSON.stringify(first)}`,
    ].filter(Boolean);
    return ok(lines.join("\n"));
  },
};
