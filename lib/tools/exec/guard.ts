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
/* Les variables d'environnement qui designent un emplacement : le compte,
   les dossiers systeme et programmes, les temporaires. Sous leurs trois
   formes : `$env:X`, `${env:X}`, `%X%`. */
const PLACES = "USERPROFILE|HOMEPATH|HOMEDRIVE|HOME|APPDATA|LOCALAPPDATA|PROGRAMDATA|ALLUSERSPROFILE|PUBLIC|ONEDRIVE|TEMP|TMP|SYSTEMROOT|SYSTEMDRIVE|WINDIR|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES";
const HOME = new RegExp(
  `(?:^|[\\s"'=(|&;<>])((?:~|\\$HOME|\\$\\{HOME\\}|\\$env:(?:${PLACES})|\\$\\{env:(?:${PLACES})\\}|%(?:${PLACES})%|\\$PSScriptRoot)(?:[\\\\/][^\\s"'|&;<>()]*)?)(?=$|[\\s"'|&;<>()])`,
  "gi",
);
/* Un chemin qui part de la racine du lecteur courant (`\Windows`) ou un
   partage reseau (`\\serveur\part`) : hors du dossier par construction. */
const WIN_ROOT = /(?:^|[\s"'=(|&;<>])(\\{1,2}[^\s"'|&;<>()]*)/g;

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
    /* Sous Windows, `/c/Users/…` est le lecteur C: vu de Git bash et les
       autres racines (`/usr`, `/tmp`) sont hors du dossier par construction.
       Sous macOS/Linux, c'est simplement un chemin absolu : on le compare au
       dossier, sinon tout chemin absolu DANS le dossier serait refuse. */
    const drive = process.platform === "win32" ? p.match(/^\/([A-Za-z])\/(.*)$/) : null;
    const resolved = process.platform !== "win32" ? path.resolve(p) : drive ? path.resolve(`${drive[1]}:/${drive[2]}`) : null;
    if (!resolved || !isInside(workspace, resolved)) push(p);
  }
  for (const m of command.matchAll(RELATIVE_UP)) {
    const p = m[1];
    if (p && !isInside(workspace, path.resolve(workspace, p))) push(p);
  }
  for (const m of command.matchAll(HOME)) {
    if (m[1]) push(m[1]);
  }
  for (const m of command.matchAll(WIN_ROOT)) {
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
