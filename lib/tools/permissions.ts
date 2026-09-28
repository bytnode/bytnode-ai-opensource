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
import { targetsLocalApi } from "./exec/local-api";

/** The tools whose first command word makes the rule. */
const SHELLS = new Set(["Bash", "PowerShell", "Monitor"]);

/** The commands whose SUB-COMMAND is part of their identity: `git status`
    and `git push` are not the same authorisation. */
const COMPOSEES = new Set([
  "git", "npm", "npx", "pnpm", "yarn", "bun", "deno", "pip", "pip3", "python", "python3", "py", "uv", "poetry", "conda",
  "docker", "kubectl", "cargo", "go", "dotnet", "gh",
  /* each system's package manager: `brew install` is not `brew list` */
  "winget", "choco", "scoop", "brew", "port", "apt", "apt-get", "dnf", "yum", "pacman", "zypper", "snap", "flatpak",
]);

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
  /* macOS / Linux: root, the disks, the services, the processes. */
  /(^|[;&|(]\s*)sudo\b/i, /(^|[;&|(]\s*)su(\s|$)/i, /\bdoas\b/i,
  /\bdiskutil\s+(erase\w*|partition\w*|zero\w*|secure\w*|reformat|unmount\w*)\b/i, /\bcsrutil\b/i, /\bspctl\b/i,
  /\bchown\s+-[a-z]*r/i,
  /\bfind\b[^\n]*\s-delete\b/i, /\bshred\b/i, /\bwipefs\b/i, /\bfdisk\b/i, /\bparted\b/i,
  /\bsystemctl\s+(stop|disable|mask|poweroff|halt)\b/i, /\blaunchctl\s+(unload|remove|bootout|disable)\b/i,
  /\bcrontab\s+-r\b/i, /\bpkill\b/i, /\bkill\s+-(9|KILL)\b/i, /\bhalt\b/i, /\bpoweroff\b/i,
  /* Windows: the registry, the boot, the shadow copies, the disks. */
  /\breg\s+(delete|add)\b/i, /\bremove-itemproperty\b/i, /\bbcdedit\b/i, /\bvssadmin\b/i, /\bcipher\s+\/w/i,
  /\bformat-volume\b/i, /\bclear-disk\b/i, /\bstop-computer\b/i, /\brestart-computer\b/i,
  /\bset-executionpolicy\b/i, /\bstop-process\b[^\n]*-force/i, /\btaskkill\b[^\n]*\/f\b/i,
];

/** An irreversible command, or one that touches the system? (the file
    tools, bounded by the scope, are not concerned) A call to the app's own
    API (`curl …127.0.0.1…/api/…`) is one too: it could approve a plugin
    the agent wrote itself (`exec/local-api.ts`). */
export function isDangerous(name: string, args: Record<string, unknown>): boolean {
  if (!SHELLS.has(name)) return false;
  const cmd = commande(args);
  return cmd.length > 0 && (DANGERS.some((r) => r.test(cmd)) || targetsLocalApi(cmd));
}

/* ⚠️ A RULE NAMES ONE PROGRAM, SO IT MAY ONLY COVER ONE PROGRAM. The rule is
   made from the first word(s); `ls && del notes.txt`, `Get-Date; Remove-Item x`,
   `cat r.md | curl --data-binary @- …` or `echo $(…)` start with an allowed
   word and run something else. Anything that chains, pipes, substitutes,
   redirects, groups or spans lines — in bash or PowerShell (`;`, `&`, `|`,
   backtick, `$(`, `@(`, `(…)`, `{…}` script blocks, `<`, `>`, newlines) — or
   hands a command to `find -exec`, is not simple: it asks. Deliberately
   broad: `python -c "print(1)"` asks too, one prompt too many costs nothing. */
const NOT_SIMPLE = [/[;&|`<>\r\n{}()]/, /(^|\s)-(exec|execdir|ok|okdir)(\s|$)/i];

/** One program with its arguments, nothing chained or substituted? */
export const isSimpleCommand = (cmd: string): boolean => cmd.trim().length > 0 && !NOT_SIMPLE.some((r) => r.test(cmd));

/** The rule an "Always" would store for this call, or `null` when the call
    does not lend itself to one. `critical`: the tool's own policy says it
    always asks (beyond the core's floor). A compound command gets none: the
    rule would promise "ls …" and never match that line again. */
export function ruleFor(name: string, args: Record<string, unknown>, critical = false): string | null {
  if (critical || alwaysAsks(name)) return null;
  if (!SHELLS.has(name)) return name;
  const cmd = commande(args);
  if (!cmd || !isSimpleCommand(cmd)) return null;
  const mots = cmd.split(/\s+/);
  const tete = mots[0];
  const prefixe = COMPOSEES.has(tete.toLowerCase()) && sousCommande(mots[1]) ? `${tete} ${mots[1]}` : tete;
  return `${name}(${prefixe} *)`;
}

/** Is this call covered by a rule already stored? */
export function matchesRule(rules: string[] | undefined, name: string, args: Record<string, unknown>, critical = false): boolean {
  if (!rules?.length) return false;
  if (critical || alwaysAsks(name) || isDangerous(name, args)) return false;
  /* Even a rule on the whole shell (`Bash`) covers simple commands only. */
  if (SHELLS.has(name) && !isSimpleCommand(commande(args))) return false;
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
