/* ---------------------------------------------------------------------------
   "Always", but not "everything".

   "Always for this agent" used to flip the agent to direct execution: one
   click, and nothing was ever asked again — ever. It is the most dangerous
   permission of an agent application, because it is also the most
   convenient: everybody clicks it.

   Now an "Always" stores ONE RULE: the tool concerned, or the start of the
   command for a shell (`Bash(git status *)`). Everything else keeps
   asking. And some commands — recursive deletion, formatting, reboot,
   force push, pipe into an interpreter — are never covered by a rule: they
   ask again every time.

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

import { alwaysAsks } from "./names";

/** The tools whose first command word makes the rule. */
const SHELLS = new Set(["Bash", "PowerShell", "Monitor"]);

/** The commands whose SUB-COMMAND is part of their identity: `git status`
    and `git push` are not the same authorisation. */
const COMPOSEES = new Set(["git", "npm", "npx", "pnpm", "yarn", "pip", "pip3", "python", "py", "docker", "cargo", "go", "dotnet", "gh", "winget"]);

/** A sub-command, as opposed to an argument: a simple word, with no path
    and no extension (`status`, `install`, `run`) — `script.py` or `./x`
    are arguments, and do not enter the rule. */
const sousCommande = (mot: string | undefined) => !!mot && /^[a-z][a-z0-9:_-]*$/i.test(mot);

const commande = (args: Record<string, unknown>) => (typeof args.command === "string" ? args.command.trim() : "");

/** ⚠️ What is never authorised in advance. Deliberately broad: one prompt
    too many costs nothing, one deletion too many does. */
const DANGERS: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\bremove-item\b[^\n]*-recurse\b/i,
  /\bdel\s+\/s\b/i, /\brd\s+\/s\b/i, /\brmdir\s+\/s\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i, /\breboot\b/i, /\bdiskpart\b/i,
  /\bgit\s+push\b[^\n]*--force/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\s+-[a-z]*f/i,
  /\bdrop\s+(table|database)\b/i, /\bdelete\s+from\b/i, /\btruncate\s+table\b/i,
  /\|\s*(ba)?sh\b/i, /\birm\b[^\n]*\|\s*iex/i, /\binvoke-expression\b/i,
  /\bchmod\s+777\b/i, /\btakeown\b/i, /\bicacls\b/i,
  /\bnetsh\b/i, /\bsc\s+(delete|stop)\b/i, /\bkillall\b/i,
  /\bcurl\b[^\n]*\|\s*\w+/i, /\bwget\b[^\n]*\|\s*\w+/i,
];

/** An irreversible command, or one that touches the system? (the file
    tools, bounded by the scope, are not concerned) */
export function isDangerous(name: string, args: Record<string, unknown>): boolean {
  if (!SHELLS.has(name)) return false;
  const cmd = commande(args);
  return cmd.length > 0 && DANGERS.some((r) => r.test(cmd));
}

/** The rule an "Always" would store for this call, or `null` when the call
    does not lend itself to one. `critical`: the tool's own policy says it
    always asks (beyond the core's floor). */
export function ruleFor(name: string, args: Record<string, unknown>, critical = false): string | null {
  if (critical || alwaysAsks(name)) return null;
  if (!SHELLS.has(name)) return name;
  const cmd = commande(args);
  if (!cmd) return null;
  const mots = cmd.split(/\s+/);
  const tete = mots[0];
  const prefixe = COMPOSEES.has(tete.toLowerCase()) && sousCommande(mots[1]) ? `${tete} ${mots[1]}` : tete;
  return `${name}(${prefixe} *)`;
}

/** Is this call covered by a rule already stored? */
export function matchesRule(rules: string[] | undefined, name: string, args: Record<string, unknown>, critical = false): boolean {
  if (!rules?.length) return false;
  if (critical || alwaysAsks(name) || isDangerous(name, args)) return false;
  if (rules.includes(name)) return true;
  const r = ruleFor(name, args);
  return r !== null && rules.includes(r);
}

export const addRule = (rules: string[] | undefined, rule: string): string[] =>
  (rules ?? []).includes(rule) ? (rules ?? []) : [...(rules ?? []), rule];

export const removeRule = (rules: string[] | undefined, rule: string): string[] => (rules ?? []).filter((r) => r !== rule);

/** The button label, which must say exactly what is being authorised. */
export function ruleLabel(rule: string): string {
  const m = rule.match(/^\w+\((.*?)\s*\*\)$/);
  return m ? `Always allow "${m[1]} …"` : `Always allow ${rule}`;
}
