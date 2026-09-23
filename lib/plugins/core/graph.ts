import type { PluginManifest } from "@/lib/domain/plugins";

/* ---------------------------------------------------------------------------
   The plugins as a graph: who needs whom.

   `requires` is a hard edge — a plugin does not start without it, and is
   disabled with it. `optional` is a soft edge — the plugin starts after it
   when it is there, and restarts when it comes or goes, so it never holds a
   service that no longer exists.

   Pure: shared browser (the library explains the cascades) / server (the
   runtime starts in this order), tested.
--------------------------------------------------------------------------- */

const byId = (manifests: PluginManifest[]) => new Map(manifests.map((m) => [m.id, m]));

/** The order to start the plugins in: each one after what it requires and
    what it optionally uses. Throws on an unknown required plugin or a
    cycle — a catalog bug, caught by the tests. */
export function startOrder(manifests: PluginManifest[]): string[] {
  const index = byId(manifests);
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") throw new Error(`Plugin dependency cycle: ${[...path, id].join(" → ")}.`);
    const m = index.get(id);
    if (!m) throw new Error(`Unknown plugin required by ${path[path.length - 1] ?? "?"}: ${id}.`);
    state.set(id, "visiting");
    for (const dep of m.requires) visit(dep, [...path, id]);
    for (const dep of m.optional) if (index.has(dep)) visit(dep, [...path, id]);
    state.set(id, "done");
    order.push(id);
  };
  for (const m of manifests) visit(m.id, []);
  return order;
}

/** Everything a plugin requires, directly or through another. */
export function requirementsOf(manifests: PluginManifest[], id: string): string[] {
  const index = byId(manifests);
  const out = new Set<string>();
  const walk = (x: string) => {
    for (const dep of index.get(x)?.requires ?? []) {
      if (out.has(dep)) continue;
      out.add(dep);
      walk(dep);
    }
  };
  walk(id);
  return [...out];
}

function dependents(manifests: PluginManifest[], id: string, soft: boolean): string[] {
  const out = new Set<string>();
  const walk = (x: string) => {
    for (const m of manifests) {
      const uses = m.requires.includes(x) || (soft && m.optional.includes(x));
      if (uses && !out.has(m.id)) {
        out.add(m.id);
        walk(m.id);
      }
    }
  };
  walk(id);
  return startOrder(manifests).filter((x) => out.has(x));
}

/** The plugins that cannot run without this one, directly or not: they
    are disabled with it. In start order. */
export const requiredBy = (manifests: PluginManifest[], id: string): string[] => dependents(manifests, id, false);

/** The plugins that must restart when this one starts, stops or changes:
    those that require it and those that use it optionally. */
export const affectedBy = (manifests: PluginManifest[], id: string): string[] => dependents(manifests, id, true);

/** The plugins that are enabled AND whose every requirement is: a plugin
    whose dependency is off cannot run, whatever its own switch says. */
export function effectivelyEnabled(manifests: PluginManifest[], isEnabled: (id: string) => boolean): Set<string> {
  const on = new Set<string>();
  const index = byId(manifests);
  for (const id of startOrder(manifests)) {
    const m = index.get(id)!;
    if (isEnabled(id) && m.requires.every((dep) => on.has(dep))) on.add(id);
  }
  return on;
}
