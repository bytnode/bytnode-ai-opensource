import type { PluginConfigSchema, PluginManifest } from "@/lib/domain/plugins";

/* A minimal manifest for the core's tests: only the graph and the
   configuration matter. */
export const manifest = (id: string, requires: string[] = [], optional: string[] = [], config: PluginConfigSchema["properties"] = {}): PluginManifest => ({
  id,
  name: id,
  version: "1.0.0",
  tier: "core",
  category: "tools",
  summary: id,
  description: id,
  requires,
  optional,
  needs: [],
  config: { type: "object", properties: config },
  views: [],
  data: "Nothing.",
});
