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
$d.UseDescriptionForTitle = $true
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
    result = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Agent workspace")'], opts);
  } else {
    result = await run("zenity", ["--file-selection", "--directory", "--title=Agent workspace"], opts);
  }
  const chosen = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  if (!chosen) {
    /* cancelled, or no dialog available */
    const why = result.code === 0 || result.code === 1 ? null : result.stderr.trim() || `code ${result.code}`;
    return Response.json({ path: null, error: why });
  }
  return Response.json({ path: chosen.replace(/[\/]+$/, "") });
}
