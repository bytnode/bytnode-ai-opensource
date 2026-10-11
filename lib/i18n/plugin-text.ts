import type { ConfigProperty, PluginCategory, PluginManifest, PluginView } from "@/lib/domain/plugins";
import type { Messages } from "./messages/en";
import { currentMessages } from "./store";

/* ---------------------------------------------------------------------------
   A plugin's words on screen, in the interface's language.

   The manifests stay in English: the server and the agents read them. The
   screens ask here for what the user sees — the name, the line in the
   library, the page, the tabs, the settings — and get the translation of a
   shipped plugin, or the manifest's own words for one an agent wrote (it
   has no translation). Call them at render, in a component that reads
   `useMessages()`, so a change of language renders them again.
--------------------------------------------------------------------------- */

type ManifestText = {
  name: string;
  summary: string;
  description: string;
  data: string | null;
  views: Record<string, { title: string; description: string } | undefined>;
  config: Record<string, { title: string; description?: string; enumLabels?: string[] } | undefined>;
};

const textOf = (pluginId: string, m: Messages = currentMessages()): ManifestText | undefined =>
  (m.plugins.manifests as Record<string, ManifestText | undefined>)[pluginId];

export function pluginText(manifest: PluginManifest, m?: Messages): { name: string; summary: string; description: string; data: string | null } {
  const t = manifest.tier === "core" ? textOf(manifest.id, m) : undefined;
  return {
    name: t?.name ?? manifest.name,
    summary: t?.summary ?? manifest.summary,
    description: t?.description ?? manifest.description,
    data: t ? t.data : manifest.data,
  };
}

/** A view's title and description; `pluginId` is the plugin that owns it. */
export function viewText(pluginId: string, view: PluginView, m?: Messages): { title: string; description: string } {
  const t = textOf(pluginId, m)?.views[view.id];
  return { title: t?.title ?? view.title, description: t?.description ?? view.description };
}

/** One setting of a plugin: its label, its help, its choices' labels. */
export function configText(pluginId: string, key: string, field: ConfigProperty, m?: Messages): { title: string; description?: string; enumLabels?: string[] } {
  const t = textOf(pluginId, m)?.config[key];
  return { title: t?.title ?? field.title, description: t?.description ?? field.description, enumLabels: t?.enumLabels ?? field.enumLabels };
}

export const categoryLabel = (id: PluginCategory, m: Messages = currentMessages()): string => m.plugins.categories[id];
