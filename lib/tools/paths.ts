import path from "node:path";

/* ---------------------------------------------------------------------------
   Les chemins, et le perimetre.

   Un chemin relatif se resout dans le dossier de travail de l'agent. Ce
   qu'on fait d'un chemin qui en sort depend du PERIMETRE de l'agent :
     - `workspace` : refuse. L'agent ne lit ni n'ecrit rien dehors.
     - `disk`      : accepte. Tout le disque, comme un outil de developpement.
   La comparaison ignore `..`, les prefixes trompeurs (`/work` contre
   `/work2`) et, sous Windows, la casse.

   ⚠️ CE PERIMETRE NE VAUT QUE POUR LES OUTILS FICHIERS. Un shell demarre dans
   le dossier de travail mais rien ne l'empeche d'en sortir — c'est dit au
   modele, et c'est le mode « demander avant d'agir » qui protege la.
--------------------------------------------------------------------------- */

export type Scope = "workspace" | "disk";

export class OutsideWorkspaceError extends Error {
  constructor(public readonly requested: string) {
    super(`Chemin hors du dossier de travail : ${requested}. Le périmètre de cet agent est limité à son dossier de travail.`);
    this.name = "OutsideWorkspaceError";
  }
}

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

export function isInside(workspace: string, absolute: string): boolean {
  const rel = path.relative(norm(path.resolve(workspace)), norm(absolute));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolvePath(workspace: string, requested: string, scope: Scope = "workspace"): string {
  const target = path.resolve(workspace, requested);
  if (scope === "workspace" && !isInside(workspace, target)) throw new OutsideWorkspaceError(requested);
  return target;
}

/** Le chemin tel qu'on le montre : relatif au dossier de travail quand il y
    est, absolu sinon. Toujours avec des barres obliques. */
export function displayPath(workspace: string, absolute: string): string {
  const rel = path.relative(workspace, absolute);
  if (rel === "") return ".";
  return (isInside(workspace, absolute) ? rel : absolute).split(path.sep).join("/");
}
