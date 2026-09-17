import fs from "node:fs";
import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { describeRun, run } from "./run";
import { findOutsideReferences, outsideMessage } from "./guard";

/* ---------------------------------------------------------------------------
   Bash et PowerShell : une commande, dans le dossier de travail de l'agent.

   Le shell demarre dans ce dossier, avec l'environnement de l'utilisateur.
   En perimetre « dossier de travail », la commande est lue avant d'etre
   lancee et refusee si elle designe un emplacement exterieur (voir
   `guard.ts`) ; c'est un garde sur le texte, et le mode « demander avant »
   reste le vrai filet.

   Sous Windows, Bash est celui de Git ; s'il manque, l'outil le dit au lieu
   de tourner a vide.
--------------------------------------------------------------------------- */

type Args = { command: string; timeout?: number; description?: string };

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;

const clampTimeout = (ms?: number) => Math.min(MAX_TIMEOUT, Math.max(1_000, ms ?? DEFAULT_TIMEOUT));

export function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function findPowerShell(): string {
  if (process.platform === "win32") {
    return fs.existsSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe") ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : "powershell.exe";
  }
  return "pwsh";
}

const timeoutParam = { type: "integer", description: "Temps limite en millisecondes (défaut 120000, max 600000)." };
const descriptionParam = { type: "string", description: "Ce que fait la commande, en quelques mots." };

/** Les deux shells, avec celui du systeme declare par defaut : sous Windows
    PowerShell (chemins natifs `C:\\…`), ailleurs Bash. L'autre reste
    disponible, mais le modele sait lequel prendre d'abord. */
export function makeShellTools(defaultShell: "Bash" | "PowerShell") {
  const bashNote =
    defaultShell === "Bash"
      ? "C'est le shell par défaut sur ce système."
      : "Sur ce système (Windows) c'est le shell SECONDAIRE : bash de Git, chemins de style Unix (`/c/Users/...`, pas `C:\\`). Préférez PowerShell sauf si vous avez besoin d'outils Unix (grep, sed, awk, pipes).";
  const psNote =
    defaultShell === "PowerShell"
      ? "C'est le shell PAR DÉFAUT sur ce système (Windows) : chemins natifs `C:\\...`, commandes Get-ChildItem, Get-Content, etc."
      : "Sur ce système c'est le shell secondaire (pwsh) ; préférez Bash.";
  return {
    bashTool: { ...bashTool, description: `${bashTool.description} ${bashNote}` },
    powershellTool: { ...powershellTool, description: `${powershellTool.description} ${psNote}` },
  };
}

export const bashTool: Tool<Args> = {
  name: "Bash",
  description:
    "Exécute une commande shell (bash) dans le dossier de travail et rend sa sortie. Pour lire, chercher ou modifier des fichiers, préférez Read, Glob, Grep et Edit. Pas de commande interactive.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "La commande." }, timeout: timeoutParam, description: descriptionParam },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const bash = findBash();
    if (!bash) return fail("Aucun bash trouvé sur cette machine (Git pour Windows n'est pas installé). Utilisez PowerShell.");
    if (ctx.scope === "workspace") {
      const refs = findOutsideReferences(args.command, ctx.workspace);
      if (refs.length) return fail(outsideMessage(refs));
    }
    try {
      const r = await run(bash, ["-lc", args.command], {
        cwd: ctx.workspace,
        timeoutMs: clampTimeout(args.timeout),
        signal: ctx.signal,
        env: { MSYS: "winsymlinks:nativestrict", MSYS_NO_PATHCONV: "1" },
      });
      return (r.code === 0 && !r.timedOut && !r.aborted ? ok : fail)(describeRun(r, "bash"));
    } catch (e) {
      return fail(`Bash a échoué : ${errorText(e)}`);
    }
  },
};

export const powershellTool: Tool<Args> = {
  name: "PowerShell",
  description:
    "Exécute une commande PowerShell dans le dossier de travail et rend sa sortie. Natif sous Windows (pwsh 7 si présent, sinon Windows PowerShell). Pas de commande interactive.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "La commande." }, timeout: timeoutParam, description: descriptionParam },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (ctx.scope === "workspace") {
      const refs = findOutsideReferences(args.command, ctx.workspace);
      if (refs.length) return fail(outsideMessage(refs));
    }
    try {
      const r = await run(findPowerShell(), ["-NoProfile", "-NonInteractive", "-Command", args.command], {
        cwd: ctx.workspace,
        timeoutMs: clampTimeout(args.timeout),
        signal: ctx.signal,
      });
      return (r.code === 0 && !r.timedOut && !r.aborted ? ok : fail)(describeRun(r, "PowerShell"));
    } catch (e) {
      return fail(`PowerShell a échoué : ${errorText(e)}`);
    }
  },
};
