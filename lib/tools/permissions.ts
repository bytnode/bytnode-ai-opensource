/* ---------------------------------------------------------------------------
   « Toujours », mais pas « tout ».

   Autrefois, « Toujours pour cet agent » basculait l'agent en execution
   directe : un clic, et plus rien n'etait demande — jamais. C'est la
   permission la plus dangereuse d'une application d'agents, parce qu'elle
   est aussi la plus pratique : tout le monde la clique.

   Desormais un « Toujours » memorise UNE REGLE : l'outil concerne, ou le
   debut de la commande pour un shell (`Bash(git status *)`). Le reste
   continue de demander. Et certaines commandes — effacement recursif,
   formatage, redemarrage, poussee forcee, tuyau vers un interpreteur — ne
   sont jamais couvertes par une regle : elles redemandent a chaque fois.

   Pur : partage navigateur / serveur, teste.
--------------------------------------------------------------------------- */

/** Les outils dont le premier mot de la commande fait la regle. */
const SHELLS = new Set(["Bash", "PowerShell", "Monitor"]);

/** Les commandes dont la SOUS-COMMANDE fait partie de l'identite : `git
    status` et `git push` ne sont pas la meme autorisation. */
const COMPOSEES = new Set(["git", "npm", "npx", "pnpm", "yarn", "pip", "pip3", "python", "py", "docker", "cargo", "go", "dotnet", "gh", "winget"]);

/** Une sous-commande, par opposition a un argument : un mot simple, sans
    chemin ni extension (`status`, `install`, `run`) — `script.py` ou
    `./x` sont des arguments, et n'entrent pas dans la regle. */
const sousCommande = (mot: string | undefined) => !!mot && /^[a-z][a-z0-9:_-]*$/i.test(mot);

const commande = (args: Record<string, unknown>) => (typeof args.command === "string" ? args.command.trim() : "");

/** ⚠️ Ce qui ne s'autorise jamais d'avance. Volontairement large : le cout
    d'une demande de trop est nul, celui d'un effacement de trop ne l'est
    pas. */
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

/** Une commande irreversible ou qui touche au systeme ? (les outils
    fichiers, bornes par le perimetre, ne sont pas concernes) */
export function isDangerous(name: string, args: Record<string, unknown>): boolean {
  if (!SHELLS.has(name)) return false;
  const cmd = commande(args);
  return cmd.length > 0 && DANGERS.some((r) => r.test(cmd));
}

/** La regle qu'un « Toujours » memoriserait pour cet appel, ou `null` si
    l'appel ne s'y prete pas. */
export function ruleFor(name: string, args: Record<string, unknown>): string | null {
  if (!SHELLS.has(name)) return name;
  const cmd = commande(args);
  if (!cmd) return null;
  const mots = cmd.split(/\s+/);
  const tete = mots[0];
  const prefixe = COMPOSEES.has(tete.toLowerCase()) && sousCommande(mots[1]) ? `${tete} ${mots[1]}` : tete;
  return `${name}(${prefixe} *)`;
}

/** Cet appel est-il couvert par une regle deja memorisee ? */
export function matchesRule(rules: string[] | undefined, name: string, args: Record<string, unknown>): boolean {
  if (!rules?.length) return false;
  if (isDangerous(name, args)) return false;
  if (rules.includes(name)) return true;
  const r = ruleFor(name, args);
  return r !== null && rules.includes(r);
}

export const addRule = (rules: string[] | undefined, rule: string): string[] =>
  (rules ?? []).includes(rule) ? (rules ?? []) : [...(rules ?? []), rule];

export const removeRule = (rules: string[] | undefined, rule: string): string[] => (rules ?? []).filter((r) => r !== rule);

/** Le libelle du bouton, qui doit dire exactement ce qu'on autorise. */
export function ruleLabel(rule: string): string {
  const m = rule.match(/^\w+\((.*?)\s*\*\)$/);
  return m ? `Toujours autoriser « ${m[1]} … »` : `Toujours autoriser ${rule}`;
}
