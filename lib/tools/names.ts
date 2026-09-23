/* What the browser knows about the tools without importing them: the
   core's floor of guarantees, and how to summarise a call in one line.
   Each tool's own policy is declared next to its code (`Tool.policy`,
   resolved by `policy.ts`); what is here cannot be lowered by any
   declaration. Shared with the server. */

/** The exchange tools that act. */
export const EXCHANGE_ACTIONS = new Set(["PlaceOrder", "CancelOrder", "ClosePosition", "Transfer", "SetLeverage"]);

/** ⚠️ The tools that commit funds: they ALWAYS ask, whatever the agent's
    mode, with no "Always" button and no rule possible. */
export const ALWAYS_ASK = new Set(["PlaceOrder", "ClosePosition", "Transfer"]);

export const alwaysAsks = (name: string) => ALWAYS_ASK.has(name);

/** ⚠️ What a sub-agent (Workflow) or a background run never receives: it
    has nobody to ask. Workflow itself, and every exchange tool that acts. */
export const NEVER_BACKGROUND = new Set(["Workflow", ...EXCHANGE_ACTIONS]);

/** Does the title of an external agent's call (`mcp__bytnode-ai__PlaceOrder`…)
    designate a tool that always asks? `extra`: the always-ask tools
    declared beyond the core's floor. */
export const isAlwaysAskTitle = (title: string, extra: Iterable<string> = []) => [...ALWAYS_ASK, ...extra].some((n) => title.includes(n));

/** A Workflow call, under its native name or that of an MCP server
    (`mcp__bytnode-ai__Workflow`). */
export const isWorkflowName = (name: string) => /(?:^|[_/.:-])Workflow$/.test(name);

/** An OpenView call, native or served over MCP (`mcp__bytnode-ai__OpenView`). */
export const isOpenViewName = (name: string) => /(?:^|[_/.:-])OpenView$/.test(name);

/** The paper trading tools: simulated, never real money — badge PAPER. */
export const isPaperTool = (name: string) => /(?:^|[_/.:-])Paper[A-Z]\w*$/.test(name);

/** The exchange tools, for the LIVE / TESTNET badge. */
export const isExchangeTool = (name: string) => name.startsWith("Exchange") || EXCHANGE_ACTIONS.has(name);

/** The argument that summarises a call: the path, the command, the pattern… */
export function summarizeCall(name: string, args: Record<string, unknown>): string {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return s("file_path");
    case "NotebookEdit":
      return `${s("notebook_path")} · cell ${args.cell_index ?? "?"}`;
    case "Glob":
      return s("pattern");
    case "Grep":
      return `/${s("pattern")}/${s("glob") ? ` in ${s("glob")}` : ""}`;
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
      return `${s("strategy")} on ${s("data")}`;
    case "Memory":
      return `${s("action")}${s("text") ? ` · ${s("text").slice(0, 60)}` : s("query") ? ` · ${s("query")}` : ""}`;
    case "TodoWrite": {
      if (!Array.isArray(args.todos)) return "";
      const done = (args.todos as Array<{ status?: unknown }>).filter((t) => t?.status === "completed").length;
      return `${done}/${args.todos.length} done`;
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
      return [s("account"), args.all === true ? `all ${s("symbol")} orders`.replace(/\s+/g, " ").trim() : `#${s("orderId")}`].filter(Boolean).join(" · ");
    case "ClosePosition": {
      const f = typeof args.fraction === "number" && args.fraction < 1 ? ` ${Math.round(args.fraction * 100)} %` : "";
      return [s("account"), `${s("symbol")}${f}`].filter(Boolean).join(" · ");
    }
    case "Transfer":
      return [s("account"), `${args.amount ?? ""} ${s("asset")} ${s("from")} → ${s("to")}`.trim()].filter(Boolean).join(" · ");
    case "SetLeverage":
      return [s("account"), `${s("symbol")} ×${args.leverage ?? "?"}${s("marginMode") ? ` ${s("marginMode")}` : ""}`].filter(Boolean).join(" · ");
    default:
      if (isWorkflowName(name)) return Array.isArray(args.tasks) ? `${(args.tasks as unknown[]).length} sub-agent${(args.tasks as unknown[]).length > 1 ? "s" : ""}` : "";
      if (isOpenViewName(name)) return s("view");
      return "";
  }
}
