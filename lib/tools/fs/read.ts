import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { OutsideWorkspaceError, displayPath, resolvePath } from "../paths";
import type { Notebook } from "./notebook-edit";

/* ---------------------------------------------------------------------------
   Read : lire un fichier.

   Du texte, numerote comme `cat -n` pour que le modele cite des lignes ; une
   image, envoyee telle quelle au modele (en piece jointe du resultat) ; un
   PDF, dont on extrait le texte ; un carnet Jupyter, cellule par cellule
   avec leurs sorties textuelles. Une fenetre `offset`/`limit` pour les gros
   fichiers.
--------------------------------------------------------------------------- */

type Args = { file_path: string; offset?: number; limit?: number };

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_IMAGE = 5 * 1024 * 1024;
/** Au-dela, un fichier texte n'est pas charge d'un bloc : Grep, un `head`
    en shell, ou pandas pour un CSV. */
export const MAX_TEXT_BYTES = 50 * 1024 * 1024;
const DEFAULT_LIMIT = 2000;

export function numberLines(text: string, offset = 1, limit = DEFAULT_LIMIT): { body: string; total: number; shown: [number, number] } {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const start = Math.max(1, offset);
  const slice = lines.slice(start - 1, start - 1 + limit);
  const width = String(start + slice.length - 1).length;
  const body = slice.map((l, i) => `${String(start + i).padStart(width)}\t${l}`).join("\n");
  return { body, total: lines.length, shown: [start, start + slice.length - 1] };
}

const cellText = (src: string[] | string) => (Array.isArray(src) ? src.join("") : src);

export function renderNotebook(nb: Notebook): string {
  return nb.cells
    .map((c, i) => {
      const head = `── cellule ${i} (${c.cell_type}) ──`;
      const outs = (c.outputs ?? [])
        .map((o) => {
          const out = o as { output_type?: string; text?: string[] | string; data?: Record<string, string[] | string>; ename?: string; evalue?: string };
          if (out.output_type === "stream" && out.text) return cellText(out.text);
          if (out.output_type === "error") return `${out.ename}: ${out.evalue}`;
          const plain = out.data?.["text/plain"];
          return plain ? cellText(plain) : out.data ? `[sortie ${Object.keys(out.data).join(", ")}]` : "";
        })
        .filter(Boolean)
        .join("\n");
      return `${head}\n${cellText(c.source)}${outs ? `\n── sortie ──\n${outs}` : ""}`;
    })
    .join("\n\n");
}

export const readTool: Tool<Args> = {
  name: "Read",
  description:
    "Lit un fichier. Texte et code : lignes numérotées (2000 lignes par défaut, `offset`/`limit` pour la suite). Images (png, jpg, gif, webp) : l'image vous est montrée. PDF : texte extrait. Carnets Jupyter (.ipynb) : cellules et sorties.",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Chemin du fichier (relatif au dossier de travail ou absolu)." },
      offset: { type: "integer", description: "Première ligne à lire (1 = début)." },
      limit: { type: "integer", description: "Nombre de lignes à lire." },
    },
    required: ["file_path"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let target: string;
    try {
      target = resolvePath(ctx.workspace, args.file_path, ctx.scope);
    } catch (e) {
      if (e instanceof OutsideWorkspaceError) return fail(e.message);
      throw e;
    }
    const shown = displayPath(ctx.workspace, target);
    let stat;
    try {
      stat = await fs.stat(target);
    } catch (e) {
      return fail(`${shown} : ${errorText(e)}`);
    }
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return ok(`${shown} est un dossier :\n${entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n")}`);
    }
    const ext = path.extname(target).toLowerCase();

    if (!IMAGE_TYPES[ext] && stat.size > MAX_TEXT_BYTES) {
      return fail(
        `${shown} fait ${Math.round(stat.size / 1024 / 1024)} Mo : trop gros pour être lu d'un bloc (limite ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} Mo). Cherche dedans avec Grep, lis-en le début par un \`head\` en shell, ou charge-le avec pandas.`,
      );
    }

    if (IMAGE_TYPES[ext]) {
      if (stat.size > MAX_IMAGE) return fail(`${shown} fait ${Math.round(stat.size / 1024 / 1024)} Mo ; les images sont limitées à 5 Mo.`);
      const buf = await fs.readFile(target);
      const dataUrl = `data:${IMAGE_TYPES[ext]};base64,${buf.toString("base64")}`;
      return ok(`Image ${shown} (${Math.round(stat.size / 1024)} Ko) : elle vous est transmise ci-après.`, [
        { type: "image", dataUrl, name: shown, path: target },
      ]);
    }

    if (ext === ".pdf") {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(await fs.readFile(target)) });
        const data = await parser.getText();
        await parser.destroy();
        const { body, total, shown: [a, b] } = numberLines(data.text, args.offset, args.limit);
        return ok(`PDF ${shown} — ${data.total} page${data.total > 1 ? "s" : ""}, lignes ${a}–${b} sur ${total} :\n${body}`);
      } catch (e) {
        return fail(`Impossible d'extraire le texte de ${shown} : ${errorText(e)}`);
      }
    }

    let text: string;
    try {
      text = await fs.readFile(target, "utf8");
    } catch (e) {
      return fail(`Impossible de lire ${shown} : ${errorText(e)}`);
    }

    if (ext === ".ipynb") {
      try {
        const nb = JSON.parse(text) as Notebook;
        return ok(`Carnet ${shown} — ${nb.cells.length} cellules :\n\n${renderNotebook(nb)}`);
      } catch {
        /* pas un carnet valide : on le montre comme du texte */
      }
    }

    if (text.includes("\u0000")) return fail(`${shown} semble binaire (${stat.size} octets).`);
    const { body, total, shown: [a, b] } = numberLines(text, args.offset, args.limit);
    const range = total > b - a + 1 ? ` (lignes ${a}–${b} sur ${total})` : "";
    return ok(`${shown}${range}\n${body}`);
  },
};
