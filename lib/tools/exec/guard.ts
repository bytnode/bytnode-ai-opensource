import path from "node:path";
import { isInside } from "../paths";

/* ---------------------------------------------------------------------------
   Le garde des commandes, pour le perimetre « dossier de travail ».

   Un shell ne se confine pas : Windows n'a pas de chroot, et un bac a sable
   systeme serait un autre projet. Ce qu'on peut faire, c'est LIRE LA
   COMMANDE avant de la lancer et refuser celle qui designe un endroit hors
   du dossier de travail : un chemin absolu (`C:\\…`, `/c/…`, `/…`), un
   chemin relatif qui remonte au-dela de la racine (`../x`), un raccourci
   vers le compte (`~`, `$HOME`, `$env:USERPROFILE`, `%APPDATA%`…).

   ⚠️ C'EST UN GARDE SUR LE TEXTE, PAS UNE PRISON. Une commande qui construit
   son chemin autrement (variable calculee, encodage) passerait. Il arrete
   l'usage ordinaire et l'erreur ; contre un modele qui chercherait a
   contourner, c'est le mode « demander avant d'agir » qui protege.
--------------------------------------------------------------------------- */

const WIN_ABS = /(?:"([A-Za-z]:[\\/][^"]*)"|'([A-Za-z]:[\\/][^']*)'|([A-Za-z]:[\\/][^\s"'|&;<>()]*))/g;
const UNIX_ABS = /(?:^|[\s"'=(|&;<>])(\/[^\s"'|&;<>()]*)/g;
const RELATIVE_UP = /(?:^|[\s"'=(|&;<>])((?:\.\.[\\/])[^\s"'|&;<>()]*|\.\.)(?=$|[\s"'|&;<>()])/g;
const HOME = /(?:^|[\s"'=(|&;<>])((?:~|\$HOME|\$\{HOME\}|\$env:(?:USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP)|%(?:USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP)%|\$PSScriptRoot)(?:[\\/][^\s"'|&;<>()]*)?)(?=$|[\s"'|&;<>()])/g;

const ALLOWED_UNIX = new Set(["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"]);

/** Les references hors du dossier de travail trouvees dans la commande,
    telles qu'ecrites. Vide si la commande reste dedans. */
export function findOutsideReferences(command: string, workspace: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  };

  for (const m of command.matchAll(WIN_ABS)) {
    const p = m[1] ?? m[2] ?? m[3];
    if (p && !isInside(workspace, path.resolve(p))) push(p);
  }
  for (const m of command.matchAll(UNIX_ABS)) {
    const p = m[1];
    if (!p || ALLOWED_UNIX.has(p)) continue;
    /* `/c/Users/…` est le lecteur C: vu de Git bash ; les autres racines
       (`/usr`, `/tmp`) sont hors du dossier par construction. */
    const drive = p.match(/^\/([A-Za-z])\/(.*)$/);
    const resolved = drive ? path.resolve(`${drive[1]}:/${drive[2]}`) : null;
    if (!resolved || !isInside(workspace, resolved)) push(p);
  }
  for (const m of command.matchAll(RELATIVE_UP)) {
    const p = m[1];
    if (p && !isInside(workspace, path.resolve(workspace, p))) push(p);
  }
  for (const m of command.matchAll(HOME)) {
    if (m[1]) push(m[1]);
  }
  return out;
}

export function outsideMessage(refs: string[]): string {
  return (
    `Commande refusée : elle référence un emplacement hors du dossier de travail (${refs.map((r) => `« ${r} »`).join(", ")}). ` +
    "Le périmètre de cet agent est limité à son dossier de travail ; travaillez avec des chemins relatifs à l'intérieur, ou demandez à l'utilisateur d'élargir le périmètre à tout le disque dans les réglages de l'agent."
  );
}
