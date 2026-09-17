import type { Tool } from "../types";
import { errorText, fail, ok } from "../types";
import { describeRun, run } from "./run";
import { findBash } from "./shells";
import { findOutsideReferences, outsideMessage } from "./guard";

/* ---------------------------------------------------------------------------
   Monitor : surveiller une commande, ou un WebSocket, ligne a ligne.

   Chaque ligne est envoyee a l'ecran au moment ou elle sort (evenement
   `tool_line`), et l'outil rend la main au modele quand un motif `until`
   apparait, quand le processus se termine, ou au bout du temps limite.
   C'est une surveillance BORNEE : rien ne survit au tour.
--------------------------------------------------------------------------- */

type Args = { command?: string; url?: string; until?: string; timeout?: number; description?: string };

const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 600_000;
const MAX_LINES = 500;

export const monitorTool: Tool<Args> = {
  name: "Monitor",
  description:
    "Surveille une commande (`command`) ou un WebSocket (`url` ws:// ou wss://) et rend chaque ligne ou message reçu. S'arrête quand une ligne correspond à `until` (expression régulière), quand le processus se termine, ou après `timeout` ms (défaut 60000, max 600000). Utile pour attendre qu'un serveur soit prêt, qu'un build finisse, ou observer un flux.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Commande shell à surveiller (bash)." },
      url: { type: "string", description: "Adresse WebSocket à écouter (à la place de command)." },
      until: { type: "string", description: "Motif qui met fin à la surveillance." },
      timeout: { type: "integer", description: "Temps limite en millisecondes." },
      description: { type: "string", description: "Ce qu'on attend, en quelques mots." },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const timeoutMs = Math.min(MAX_TIMEOUT, Math.max(1_000, args.timeout ?? DEFAULT_TIMEOUT));
    let until: RegExp | undefined;
    if (args.until) {
      try {
        until = new RegExp(args.until);
      } catch (e) {
        return fail(`Motif until invalide : ${errorText(e)}`);
      }
    }
    const lines: string[] = [];
    const push = (line: string) => {
      if (lines.length < MAX_LINES) lines.push(line);
      ctx.emit({ type: "tool_line", id: ctx.callId, line });
    };

    if (args.url) return watchSocket(args.url, until, timeoutMs, ctx.signal, push, lines);
    if (!args.command) return fail("Donnez `command` ou `url`.");
    if (ctx.scope === "workspace") {
      const refs = findOutsideReferences(args.command, ctx.workspace);
      if (refs.length) return fail(outsideMessage(refs));
    }

    const bash = findBash();
    if (!bash) return fail("Aucun bash trouvé sur cette machine.");
    try {
      const r = await run(bash, ["-lc", args.command], {
        cwd: ctx.workspace,
        timeoutMs,
        signal: ctx.signal,
        until,
        onLine: push,
        env: { MSYS_NO_PATHCONV: "1" },
      });
      return ok(describeRun({ ...r, stdout: lines.join("\n"), stderr: "" }, "Monitor"));
    } catch (e) {
      return fail(`Monitor a échoué : ${errorText(e)}`);
    }
  },
};

function watchSocket(
  url: string,
  until: RegExp | undefined,
  timeoutMs: number,
  signal: AbortSignal,
  push: (line: string) => void,
  lines: string[],
) {
  return new Promise<ReturnType<typeof ok>>((resolve) => {
    const started = Date.now();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve(fail(`Connexion impossible à ${url} : ${errorText(e)}`));
      return;
    }
    let settled = false;
    const finish = (status: string, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* deja fermee */
      }
      const body = `${lines.join("\n")}\n[WebSocket ${url} ${status} en ${((Date.now() - started) / 1000).toFixed(1)} s, ${lines.length} message${lines.length > 1 ? "s" : ""}]`;
      resolve(failed ? fail(body) : ok(body));
    };
    const timer = setTimeout(() => finish("arrêté : temps limite dépassé"), timeoutMs);
    const onAbort = () => finish("interrompu");
    signal.addEventListener("abort", onAbort, { once: true });
    ws.onmessage = (ev) => {
      const text = typeof ev.data === "string" ? ev.data : "[message binaire]";
      push(text);
      if (until?.test(text)) finish("arrêté : motif rencontré");
    };
    ws.onerror = () => finish("en erreur", true);
    ws.onclose = () => finish("fermé par le serveur");
  });
}
