import { run } from "@/lib/tools/exec/run";
import { findPowerShell } from "@/lib/tools/exec/shells";

/* ---------------------------------------------------------------------------
   Ouvrir le selecteur de dossier du systeme, et rendre le chemin choisi.

   L'application tourne sur la machine de l'utilisateur : le serveur peut
   donc afficher la boite de dialogue native — sous Windows celle de
   l'Explorateur (FolderBrowserDialog), sous macOS celle du Finder, sous
   Linux zenity s'il est la. Le navigateur, lui, ne peut pas : il ne donne
   jamais le chemin d'un dossier.

   ⚠️ LA BOITE PEUT S'OUVRIR DERRIERE LE NAVIGATEUR. On la rattache a une
   fenetre invisible marquee « toujours au premier plan » pour qu'elle
   passe devant.
--------------------------------------------------------------------------- */

const WINDOWS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = "Dossier de travail de l'agent"
$d.ShowNewFolderButton = $true
$d.UseDescriptionForTitle = $true
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
$owner.Close()
`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { initial?: string };
  const opts = { cwd: process.cwd(), timeoutMs: 5 * 60_000, signal: req.signal };
  let result;
  if (process.platform === "win32") {
    const script = body.initial ? WINDOWS_SCRIPT.replace("$d.ShowNewFolderButton", `$d.SelectedPath = ${JSON.stringify(body.initial)}\n$d.ShowNewFolderButton`) : WINDOWS_SCRIPT;
    result = await run(findPowerShell(), ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], opts);
  } else if (process.platform === "darwin") {
    result = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Dossier de travail de l\'agent")'], opts);
  } else {
    result = await run("zenity", ["--file-selection", "--directory", "--title=Dossier de travail de l'agent"], opts);
  }
  const chosen = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  if (!chosen) {
    /* annule, ou pas de boite de dialogue disponible */
    const why = result.code === 0 || result.code === 1 ? null : result.stderr.trim() || `code ${result.code}`;
    return Response.json({ path: null, error: why });
  }
  return Response.json({ path: chosen.replace(/[\/]+$/, "") });
}
