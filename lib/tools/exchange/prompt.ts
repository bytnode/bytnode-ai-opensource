import type { ExchangeAccount } from "@/lib/domain/types";
import { anyLive, describeAccounts } from "./accounts";
import { exchangeInfo } from "./catalog";

/* The prompt section that presents the agent's exchange accounts and the
   discipline that goes with them. Shared: OpenRouter agents
   (`tools-prompt.ts`) and subscription agents (`lib/acp/prompt.ts`). Empty
   without an account. Pure. */

export function exchangePromptSection(
  accounts: ExchangeAccount[] | undefined,
  via: "natif" | "mcp",
  unattached = 0,
  /** A sub-agent: the five read-only tools only, nothing that acts. */
  readOnly = false,
): string[] {
  /* Accounts exist but none is attached to this agent: let it say so,
     instead of looking for a key in the folder or writing a script — it
     has NO exchange tool, and that is the user's choice, reversible in the
     settings. */
  if (!accounts?.length) {
    if (unattached <= 0) return [];
    return [
      "",
      "## Exchange accounts",
      "",
      `The user has configured ${unattached} exchange account${unattached > 1 ? "s" : ""} in BytNode-AI, but none is attached to you: you have no exchange tool in this conversation. If they ask you to read or act on an account, answer that they must tick the account in Settings → Agents → Edit → "Exchange accounts", then send their message again. Do not look for a key in the workspace, do not write a script to access the exchange, never ask for a key in the conversation.`,
    ];
  }
  if (readOnly) {
    return [
      "",
      "## Exchange accounts (read-only)",
      "",
      `You can read ${accounts.length > 1 ? "these accounts" : "this account"}: ${describeAccounts(accounts)}.`,
      `Tools${via === "mcp" ? " (MCP server `bytnode-ai`)" : ""}: ExchangeBalance, ExchangePositions, ExchangeOrders, ExchangeTicker, ExchangeWatch. No action tool: you have no order, no close, no transfer — you report what you observe and recommend.`,
      "- If there are several accounts, always name `account`. Specify `market: futures` for perpetuals.",
      "- ExchangeWatch is bounded to 10 minutes, run it again if needed.",
    ];
  }
  const lines = [
    "",
    "## Exchange accounts",
    "",
    `You can act on ${accounts.length > 1 ? "these accounts" : "this account"}: ${describeAccounts(accounts)}.${anyLive(accounts) ? " ⚠️ Accounts marked LIVE put real money at stake." : ""}`,
    via === "mcp"
      ? "The tools come from the MCP server `bytnode-ai`: ExchangeBalance, ExchangePositions, ExchangeOrders, ExchangeTicker, ExchangeWatch (read), PlaceOrder, CancelOrder, ClosePosition, Transfer, SetLeverage (action)."
      : "Tools: ExchangeBalance, ExchangePositions, ExchangeOrders, ExchangeTicker, ExchangeWatch (read, no permission); PlaceOrder, CancelOrder, ClosePosition, Transfer, SetLeverage (action, with permission).",
    ...limitsOf(accounts),
    "Discipline:",
    "- Before an order: ExchangeBalance then ExchangeTicker on the account's exchange; compute the quantity in base asset, or give `quoteAmount`.",
    "- An order, a close or a transfer ALWAYS requires the user's consent: wait for the result, do not chain them blindly. After an order, confirm with ExchangeOrders.",
    "- If there are several accounts, always name `account`. Specify `market: futures` for perpetuals.",
    "- No withdrawal to an external address exists; Transfer only moves between the wallets of a single account (spot ↔ futures, and funding → trading where deposits land in a Funding wallet: Bybit, OKX, KuCoin, Binance). If ExchangeBalance reports funds in Funding, propose that transfer before any order.",
    "- To follow a position over time, ExchangeWatch with an `until` condition; it is bounded to 10 minutes, run it again if needed.",
    "- Load the `trading-execution` skill before placing an order, `trade-review` to analyze positions or a history.",
  ];
  return lines;
}

/** What each exchange present does not allow, one line per exchange. */
function limitsOf(accounts: ExchangeAccount[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of accounts) {
    const info = exchangeInfo(a.exchange);
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    const limits = [
      info.futures === "none" ? "spot only" : info.futures === "read" ? "futures read-only (no orders)" : null,
      !info.transfer ? "no Transfer" : null,
    ].filter(Boolean);
    if (limits.length) out.push(`- ${info.label}: ${limits.join(", ")}.${info.note ? ` ${info.note}` : ""}`);
  }
  return out.length ? ["Limits:", ...out] : [];
}
