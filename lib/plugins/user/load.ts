import type { PluginDefinition } from "../core/contract";
import { activePlugins, type ActivePlugin } from "./files";
import { userPluginDefinition, type DefinitionOptions } from "./definition";

/* ---------------------------------------------------------------------------
   The plugins written by agents that run in this process: one definition
   per approved plugin, read from disk.

   A definition is kept as long as what was approved does not change (same
   digest, same grant): the runtime restarts only the plugin that changed,
   not all of them at every reload. SERVER-ONLY.
--------------------------------------------------------------------------- */

const cache = new Map<string, { key: string; definition: PluginDefinition }>();

const keyOf = (p: ActivePlugin) => JSON.stringify([p.grant.digest, p.grant.at, p.grant.accounts, p.grant.permissions]);

export async function userDefinitions(opts: DefinitionOptions = {}): Promise<{ definitions: PluginDefinition[]; problems: Array<{ id: string; message: string }> }> {
  const { plugins, problems } = await activePlugins();
  const definitions = plugins.map((p) => {
    const key = keyOf(p);
    const hit = cache.get(p.id);
    if (hit?.key === key) return hit.definition;
    const definition = userPluginDefinition(p, opts);
    cache.set(p.id, { key, definition });
    return definition;
  });
  for (const id of cache.keys()) if (!plugins.some((p) => p.id === id)) cache.delete(id);
  return { definitions, problems };
}
