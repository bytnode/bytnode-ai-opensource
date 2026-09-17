/* Ce qui ne doit jamais partir sur npm. `scripts/prepack.ts` passe la liste
   des fichiers de l'archive (npm pack --dry-run --json) par ici et refuse
   la publication au moindre resultat. Pur : testable sans archive. */

const FORBIDDEN = [/(^|\/)\.env/, /^workspaces\//, /^sandboxes(\/|$)/, /^\.mcp\.json$/, /^scratchpad\//];

/** Les motifs d'une cle reelle : le prefixe seul (`cb_live_` dans un
    message) ne compte pas, il faut le corps. */
const SECRETS = [/cb_(live|test)_[A-Za-z0-9]{8,}/, /sk-or-v1-[A-Za-z0-9]{8,}/];

export const forbiddenPaths = (paths: string[]): string[] => paths.filter((p) => FORBIDDEN.some((re) => re.test(p)));

export const leakedSecrets = (files: { path: string; text: string }[]): string[] =>
  files.filter((f) => SECRETS.some((re) => re.test(f.text))).map((f) => f.path);

/** Les fichiers dont on lit le texte pour chercher une cle. */
export const isTextFile = (p: string) => /\.(ts|tsx|js|mjs|cjs|json|md|txt|css|yml|yaml)$/.test(p);

/** Les fichiers qui contiennent l'un de ces textes (le chemin absolu de la
    machine de build, par exemple : il nomme l'utilisateur). */
export const containing = (files: { path: string; text: string }[], needles: string[]): string[] =>
  files.filter((f) => needles.some((n) => n.length > 0 && f.text.includes(n))).map((f) => f.path);
