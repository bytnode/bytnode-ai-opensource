import type { AgentConfig, ExchangeAccount, Settings } from "@/lib/domain/types";
import { allowedAccounts, encodeAccountsHeader, parseAccountsHeader } from "./exchange/accounts";

/* ---------------------------------------------------------------------------
   What travels with a request, and how.

   The keys and the agent's configuration never live on the server: they
   leave the browser with each request that needs them, in HEADERS (never
   in a URL, never in a log). One codec for all the routes — the tools,
   their execution, a subscription turn, a sub-agent, a plugin action — so
   that a new item (the plugins enabled for the agent) is added in one
   place:
     - `x-openrouter-key`   the OpenRouter key;
     - `x-bytnode-key`      the BytNode key;
     - `x-exchange-accounts` the accounts THIS agent may drive (URI-encoded
                           JSON: a label may carry "€");
     - `x-plugins`          the plugins enabled for THIS agent (URI-encoded
                           JSON array of ids). Absent: every active plugin.

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

export const HEADER = {
  openrouter: "x-openrouter-key",
  bytnode: "x-bytnode-key",
  exchanges: "x-exchange-accounts",
  plugins: "x-plugins",
} as const;

export type Transport = {
  openrouterKey: string;
  bytnodeKey: string;
  exchangeAccounts: ExchangeAccount[];
  /** The plugin ids enabled for the agent; `null` when the request does
      not say (every active plugin then applies). */
  plugins: string[] | null;
};

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,40}$/;

/** A list of plugin ids read without trust: strings with the id shape, no
    duplicates. */
export function parsePluginIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && PLUGIN_ID.test(v)))];
}

function decodePlugins(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null;
  for (const text of [raw, safeDecode(raw)]) {
    try {
      return parsePluginIds(JSON.parse(text));
    } catch {
      /* next form */
    }
  }
  return [];
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The headers to send: only what is known and not empty. */
export function transportHeaders(t: Partial<Transport>): Record<string, string> {
  const h: Record<string, string> = {};
  if (t.openrouterKey?.trim()) h[HEADER.openrouter] = t.openrouterKey.trim();
  if (t.bytnodeKey?.trim()) h[HEADER.bytnode] = t.bytnodeKey.trim();
  if (t.exchangeAccounts?.length) h[HEADER.exchanges] = encodeAccountsHeader(t.exchangeAccounts);
  if (t.plugins) h[HEADER.plugins] = encodeURIComponent(JSON.stringify(t.plugins));
  return h;
}

/** What a request carries, whatever is missing. */
export function readTransport(headers: { get(name: string): string | null }): Transport {
  return {
    openrouterKey: headers.get(HEADER.openrouter)?.trim() ?? "",
    bytnodeKey: headers.get(HEADER.bytnode)?.trim() ?? "",
    exchangeAccounts: parseAccountsHeader(headers.get(HEADER.exchanges)),
    plugins: decodePlugins(headers.get(HEADER.plugins)),
  };
}

/** What an agent's requests carry, from the settings: the keys, the
    accounts it may drive, and the plugins enabled for it. */
export function agentTransport(settings: Settings, agent: AgentConfig, plugins: string[] | null = null): Transport {
  return {
    openrouterKey: settings.keys.openrouter,
    bytnodeKey: settings.keys.bytnode,
    exchangeAccounts: allowedAccounts(settings.keys.exchanges, agent.exchangeAccountIds),
    plugins,
  };
}
