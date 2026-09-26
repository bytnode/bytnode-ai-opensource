import { findOnPath } from "@/lib/acp/detect";
import { run } from "@/lib/tools/exec/run";
import { findPowerShell } from "@/lib/tools/exec/shells";

/* ---------------------------------------------------------------------------
   Open the system's folder picker, and return the chosen path.

   The application runs on the user's machine: the server can therefore
   show the native dialog — on Windows the Explorer one
   (FolderBrowserDialog), on macOS the Finder one, on Linux zenity if it is
   there. The browser, for its part, cannot: it never gives the path of a
   folder.

   ⚠️ THE DIALOG MAY OPEN BEHIND THE BROWSER. We attach it to an invisible
   window marked "always on top" so that it comes to the front.
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
$d.Description = "Agent workspace"
if ($env:BYTNODE_AI_INITIAL_DIR) { $d.SelectedPath = $env:BYTNODE_AI_INITIAL_DIR }
$d.ShowNewFolderButton = $true
# Absent from Windows PowerShell 5.1 (.NET Framework): its error went to stderr.
try { $d.UseDescriptionForTitle = $true } catch {}
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
$owner.Close()
`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { initial?: unknown };
  /* ⚠️ The initial folder goes through the ENVIRONMENT, never into the
     script's text: a double-quoted PowerShell string evaluates `$(…)`, and
     this path comes from the browser. */
  const initial = typeof body.initial === "string" && !/[\r\n\0]/.test(body.initial) ? body.initial.trim() : "";
  const opts = { cwd: process.cwd(), timeoutMs: 5 * 60_000, signal: req.signal, env: initial ? { BYTNODE_AI_INITIAL_DIR: initial } : {} };
  let result;
  if (process.platform === "win32") {
    result = await run(findPowerShell(), ["-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_SCRIPT], opts);
  } else if (process.platform === "darwin") {
    result = await run("osascript", MAC_SCRIPT.flatMap((line) => ["-e", line]), opts);
  } else {
    /* GNOME / XFCE ship zenity, KDE kdialog; the start folder is an
       argument (no shell in between). */
    const start = initial ? `${initial.replace(/\/+$/, "")}/` : "";
    const zenity = findOnPath("zenity");
    const kdialog = findOnPath("kdialog");
    if (zenity) result = await run(zenity, ["--file-selection", "--directory", "--title=Agent workspace", ...(start ? [`--filename=${start}`] : [])], opts);
    else if (kdialog) result = await run(kdialog, ["--title", "Agent workspace", "--getexistingdirectory", start || "."], opts);
    else return Response.json({ path: null, error: "no folder dialog on this system (install zenity or kdialog) — type the path instead" });
  }
  const chosen = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  if (!chosen) {
    /* cancelled, or no dialog available */
    const why = result.code === 0 || result.code === 1 ? null : result.stderr.trim() || `code ${result.code}`;
    return Response.json({ path: null, error: why });
  }
  /* The trailing separator goes, but `/` alone stays a folder. */
  return Response.json({ path: chosen.length > 1 ? chosen.replace(/\/+$/, "") : chosen });
}

/* macOS: the Finder's dialog, opened on the current folder when it
   exists. The folder comes from the ENVIRONMENT too, never the script's
   text. A cancel (error -128) must not fall back to a second dialog: the
   `try` covers only the reading of the folder. */
const MAC_SCRIPT = [
  'set d to system attribute "BYTNODE_AI_INITIAL_DIR"',
  "set loc to missing value",
  'try',
  'if d is not "" then set loc to (POSIX file d) as alias',
  "end try",
  'if loc is missing value then return POSIX path of (choose folder with prompt "Agent workspace")',
  'return POSIX path of (choose folder with prompt "Agent workspace" default location loc)',
];
