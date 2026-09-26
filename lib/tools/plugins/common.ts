import { activeRuntime } from "@/lib/plugins/core/active";
import { userPluginId } from "@/lib/plugins/user/manifest";
import { OPEN_VIEW } from "../views/open-view";

/* ---------------------------------------------------------------------------
   What the four tools an agent writes plugins with share: reading the
   plugin argument, and the tool names already taken. SERVER-ONLY.
--------------------------------------------------------------------------- */

export const PLUGIN_PROP = {
  type: "string",
  description: 'The plugin, by its id: lowercase letters, digits and dashes ("dividend-tracker"); the "u-" prefix is added.',
};

export function pluginArg(raw: unknown): { id: string } | { error: string } {
  const id = typeof raw === "string" ? userPluginId(raw) : null;
  return id ? { id } : { error: `Invalid plugin id: ${String(raw)}. Use 2 to 31 lowercase letters, digits or dashes, starting with a letter ("dividend-tracker").` };
}

/** Every tool name taken, by whom: "core", or the plugin that has it. */
export async function takenToolNames(): Promise<Map<string, string>> {
  const taken = new Map<string, string>();
  /* Loaded here, not at the top: the registry imports these tools. */
  const { generalTools, bytnodeAiTools } = await import("../registry");
  const account = { id: "", exchange: "binance", label: "", apiKey: "", secret: "", password: "", testnet: true };
  for (const t of [...generalTools(process.platform), ...bytnodeAiTools({ exchangeAccounts: [account] })]) taken.set(t.name, "core");
  taken.set(OPEN_VIEW, "core");
  for (const { plugin, tool } of activeRuntime()?.toolsByPlugin() ?? []) if (!taken.has(tool.name)) taken.set(tool.name, plugin);
  return taken;
}
