import { spawn } from "node:child_process";

/* ---------------------------------------------------------------------------
   Lancer un processus et en recueillir la sortie.

   Un seul point de passage pour Bash, PowerShell, Grep et Monitor : le
   temps limite, l'annulation, la lecture ligne a ligne et la borne sur la
   taille de ce qu'on garde vivent ici. Sur Windows, tuer l'arbre de
   processus demande `taskkill` — `kill()` ne touche que le parent.
--------------------------------------------------------------------------- */

export type RunOptions = {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Appele pour chaque ligne complete de stdout ou stderr. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** Quand une ligne correspond, le processus est arrete et `matched` vaut vrai. */
  until?: RegExp;
  env?: Record<string, string | undefined>;
  maxBytes?: number;
};

export type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  matched: boolean;
  durationMs: number;
};

const DEFAULT_MAX = 200_000;
/* Une « ligne » sans retour a la ligne (un binaire, un JSON d'un bloc) ne
   doit pas grossir sans fin en memoire : au-dela, elle est livree telle
   quelle et le tampon repart. */
const MAX_LINE = 1_000_000;

export function run(command: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const max = opts.maxBytes ?? DEFAULT_MAX;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let matched = false;
    let settled = false;

    const kill = () => {
      if (child.exitCode !== null || child.killed) return;
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      } else {
        child.kill("SIGKILL");
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const lineReader = (stream: "stdout" | "stderr") => {
      let rest = "";
      return (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stream === "stdout") stdout = stdout.length < max ? stdout + text : stdout;
        else stderr = stderr.length < max ? stderr + text : stderr;
        if (!opts.onLine && !opts.until) return;
        rest += text;
        const lines = rest.split(/\r?\n/);
        rest = lines.pop() ?? "";
        if (rest.length > MAX_LINE) {
          lines.push(rest);
          rest = "";
        }
        for (const line of lines) {
          opts.onLine?.(line, stream);
          if (opts.until && !matched && opts.until.test(line)) {
            matched = true;
            kill();
          }
        }
      };
    };
    child.stdout?.on("data", lineReader("stdout"));
    child.stderr?.on("data", lineReader("stderr"));

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted, matched, durationMs: Date.now() - started });
    };
    child.on("error", (e) => {
      stderr += `\n${e.message}`;
      finish(null);
    });
    child.on("close", finish);
  });
}

/** Ce qu'on rend au modele apres une commande : la sortie, puis l'etat. */
export function describeRun(r: RunResult, label: string): string {
  const parts: string[] = [];
  if (r.stdout.trim()) parts.push(r.stdout.trimEnd());
  if (r.stderr.trim()) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
  const status = r.aborted
    ? "interrompu"
    : r.timedOut
      ? `arrêté : temps limite dépassé`
      : r.matched
        ? "arrêté : motif rencontré"
        : r.code === 0
          ? "terminé (code 0)"
          : `terminé avec le code ${r.code}`;
  parts.push(`[${label} ${status} en ${(r.durationMs / 1000).toFixed(1)} s]`);
  return parts.join("\n");
}
