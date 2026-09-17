/* Ce que le navigateur sait des outils sans les importer : lesquels
   attendent l'accord de l'utilisateur en mode « demander », et comment
   resumer un appel en une ligne. Partage avec le serveur. */

/** Les outils qui agissent — sur les fichiers, le systeme, ou en lancant
    d'autres agents. En mode `ask`, chacun attend un accord. */
export const GATED_TOOLS = new Set(["Bash", "PowerShell", "Monitor", "Write", "Edit", "NotebookEdit", "Workflow", "Backtest", "PlaceOrder", "CancelOrder", "ClosePosition", "Transfer", "SetLeverage"]);

export const isGated = (name: string) => GATED_TOOLS.has(name);

/** Les outils exchange qui agissent (les cinq gated). */
const GATED_EXCHANGE = new Set(["PlaceOrder", "CancelOrder", "ClosePosition", "Transfer", "SetLeverage"]);

/** ⚠️ Les outils qui engagent des fonds : ils demandent TOUJOURS, quel que
    soit le mode de l'agent, sans « Toujours » ni regle possible. */
export const ALWAYS_ASK = new Set(["PlaceOrder", "ClosePosition", "Transfer"]);

export const alwaysAsks = (name: string) => ALWAYS_ASK.has(name);

/** Un titre d'appel d'un agent externe (`mcp__bytnode-ai__PlaceOrder`…)
    designe-t-il un de ces outils ? */
export const isAlwaysAskTitle = (title: string) => [...ALWAYS_ASK].some((n) => title.includes(n));

/** ⚠️ Un sous-agent (Workflow) n'a personne a qui demander : il ne recoit
    jamais un outil qui engage des fonds, ni Workflow lui-meme. */
export const allowedForSubagent = (name: string) => name !== "Workflow" && !GATED_EXCHANGE.has(name);

/** Un appel Workflow, sous son nom natif ou celui d'un serveur MCP
    (`mcp__bytnode-ai__Workflow`). */
export const isWorkflowName = (name: string) => /(?:^|[_/.:-])Workflow$/.test(name);

/** Les outils exchange, pour le badge RÉEL / TESTNET. */
export const isExchangeTool = (name: string) => name.startsWith("Exchange") || GATED_EXCHANGE.has(name);

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
    case "TodoWrite": {
      if (!Array.isArray(args.todos)) return "";
      const done = (args.todos as Array<{ status?: unknown }>).filter((t) => t?.status === "completed").length;
      return `${done}/${args.todos.length} faite${done > 1 ? "s" : ""}`;
    }
    case "ExchangeBalance":
    case "ExchangePositions":
      return [s("account"), s("market") || (name === "ExchangePositions" ? "futures" : ""), s("symbol")].filter(Boolean).join(" · ");
    case "ExchangeOrders":
      return [s("account"), `${s("status")} ${s("symbol")}`.trim()].filter(Boolean).join(" · ");
    case "ExchangeTicker":
    case "ExchangeWatch":
      return [s("account"), s("symbol")].filter(Boolean).join(" · ");
    case "PlaceOrder": {
      const qty = args.amount !== undefined ? String(args.amount) : args.quoteAmount !== undefined ? `${args.quoteAmount} (quote)` : "";
      const bits = [`${s("side").toUpperCase()} ${qty} ${s("symbol")} ${s("type")}`.replace(/\s+/g, " ").trim()];
      if (args.price !== undefined) bits.push(`@ ${args.price}`);
      if (args.leverage !== undefined) bits.push(`×${args.leverage}`);
      if (args.reduceOnly === true) bits.push("reduceOnly");
      return [s("account"), bits.join(" ")].filter(Boolean).join(" · ");
    }
    case "CancelOrder":
      return [s("account"), args.all === true ? `tous les ordres ${s("symbol")}`.trim() : `#${s("orderId")}`].filter(Boolean).join(" · ");
    case "ClosePosition": {
      const f = typeof args.fraction === "number" && args.fraction < 1 ? ` ${Math.round(args.fraction * 100)} %` : "";
      return [s("account"), `${s("symbol")}${f}`].filter(Boolean).join(" · ");
    }
    case "Transfer":
      return [s("account"), `${args.amount ?? ""} ${s("asset")} ${s("from")} → ${s("to")}`.trim()].filter(Boolean).join(" · ");
    case "SetLeverage":
      return [s("account"), `${s("symbol")} ×${args.leverage ?? "?"}${s("marginMode") ? ` ${s("marginMode")}` : ""}`].filter(Boolean).join(" · ");
    default:
      if (isWorkflowName(name)) return Array.isArray(args.tasks) ? `${(args.tasks as unknown[]).length} sous-agent${(args.tasks as unknown[]).length > 1 ? "s" : ""}` : "";
      return "";
  }
}
