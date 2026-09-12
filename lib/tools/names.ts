/* Ce que le navigateur sait des outils sans les importer : lesquels
   attendent l'accord de l'utilisateur en mode « demander », et comment
   resumer un appel en une ligne. Partage avec le serveur. */

/** Les outils qui agissent — sur les fichiers, le systeme, ou en lancant
    d'autres agents. En mode `ask`, chacun attend un accord. */
export const GATED_TOOLS = new Set(["Bash", "PowerShell", "Monitor", "Write", "Edit", "NotebookEdit", "Workflow", "Backtest"]);

export const isGated = (name: string) => GATED_TOOLS.has(name);

/** L'argument qui resume un appel : le chemin, la commande, le motif… */
export function summarizeCall(name: string, args: Record<string, unknown>): string {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return s("file_path");
    case "NotebookEdit":
      return `${s("notebook_path")} · cellule ${args.cell_index ?? "?"}`;
    case "Glob":
      return s("pattern");
    case "Grep":
      return `/${s("pattern")}/${s("glob") ? ` dans ${s("glob")}` : ""}`;
    case "Bash":
    case "PowerShell":
      return s("description") || s("command");
    case "Monitor":
      return s("description") || s("command") || s("url");
    case "WebSearch":
      return Array.isArray(args.queries) ? (args.queries as unknown[]).map(String).join(" · ") : "";
    case "WebFetch":
      return s("url");
    case "Skill":
      return s("name");
    case "SaveMarketData":
      return `${s("tool")} → ${s("output")}`;
    case "Chart":
      return s("title") || s("data");
    case "Backtest":
      return `${s("strategy")} sur ${s("data")}`;
    case "Memory":
      return `${s("action")}${s("text") ? ` · ${s("text").slice(0, 60)}` : s("query") ? ` · ${s("query")}` : ""}`;
    case "Workflow":
      return Array.isArray(args.tasks) ? `${(args.tasks as unknown[]).length} tâche${(args.tasks as unknown[]).length > 1 ? "s" : ""}` : "";
    default:
      return "";
  }
}
