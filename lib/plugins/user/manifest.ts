import { PLUGIN_CATEGORIES, type ConfigProperty, type PluginCategory, type PluginManifest } from "@/lib/domain/plugins";
import { validValue } from "../core/state";
import { EMPTY_PERMISSIONS, readPermissions, type Permissions } from "./permissions";

/* ---------------------------------------------------------------------------
   A plugin written by one of the user's agents: its `plugin.json`.

   The agent writes it; nothing in it is trusted as is. `readUserManifest`
   checks every field and says, in one sentence per problem, what to fix —
   those sentences go straight back to the agent. A valid one becomes an
   ordinary `PluginManifest` (tier `user`), so the runtime, the library and
   the agents' prompt treat it like the others.

   The plugin's id is its folder's name with the `u-` prefix: a user plugin
   can never take the id, the data folder or the tab of a shipped one.

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

export const USER_PREFIX = "u-";
const SLUG = /^[a-z][a-z0-9-]{1,30}$/;

export const isUserPluginId = (id: string): boolean => id.startsWith(USER_PREFIX) && SLUG.test(id.slice(USER_PREFIX.length));

/** "dividends", "u-dividends" → "u-dividends"; null when it cannot be an id. */
export function userPluginId(raw: string): string | null {
  const slug = raw.trim().toLowerCase().replace(/^u-/, "");
  return SLUG.test(slug) ? `${USER_PREFIX}${slug}` : null;
}

/** What the agent writes in `plugin.json`. */
export type UserPluginJson = {
  name: string;
  version?: string;
  category?: PluginCategory;
  /** One line, for the library: speaks to the user. */
  summary: string;
  /** What it is for, told to the agents: about "the user", never "you". */
  forAgents: string;
  description?: string;
  permissions?: Partial<Permissions>;
  config?: Record<string, ConfigProperty>;
  /** Its tab, if it has one (`view/index.html`). */
  view?: { title: string; description: string } | null;
};

export type UserManifest = {
  manifest: PluginManifest;
  permissions: Permissions;
};

const MAX = { name: 40, summary: 160, forAgents: 600, description: 2000, viewTitle: 40, viewDescription: 160, config: 12 };

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Reads a `plugin.json` already parsed. Every problem is listed, in words
    the agent can act on. */
export function readUserManifest(id: string, raw: unknown): { ok: true; value: UserManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isUserPluginId(id)) errors.push(`Invalid plugin id: ${id}.`);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: [...errors, "plugin.json must be a JSON object."] };
  const j = raw as Record<string, unknown>;

  const known = new Set(["name", "version", "category", "summary", "forAgents", "description", "permissions", "config", "view"]);
  for (const k of Object.keys(j)) if (!known.has(k)) errors.push(`Unknown field \`${k}\` in plugin.json (known: ${[...known].join(", ")}).`);

  const name = text(j.name);
  if (!name) errors.push("`name` is required: the plugin's name, as the user will see it.");
  else if (name.length > MAX.name) errors.push(`\`name\` is too long (${MAX.name} characters at most).`);

  const summary = text(j.summary);
  if (!summary) errors.push("`summary` is required: one line for the library, speaking to the user.");
  else if (summary.length > MAX.summary) errors.push(`\`summary\` is too long (${MAX.summary} characters at most).`);

  const forAgents = text(j.forAgents);
  if (forAgents.length < 40) errors.push("`forAgents` is required: at least one full sentence (40+ characters) telling the agents what the plugin is for.");
  else if (forAgents.length > MAX.forAgents) errors.push(`\`forAgents\` is too long (${MAX.forAgents} characters at most).`);
  else {
    if (!/[.!?]$/.test(forAgents)) errors.push("`forAgents` must end with a full stop.");
    if (/\byour?\b/i.test(forAgents)) errors.push('`forAgents` speaks about "the user", never "you"/"your": in an agent\'s prompt, "your" would mean the agent\'s.');
  }

  const description = text(j.description);
  if (description.length > MAX.description) errors.push(`\`description\` is too long (${MAX.description} characters at most).`);

  const version = j.version === undefined ? "1.0.0" : text(j.version);
  if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push("`version` must look like 1.0.0.");

  const categories = PLUGIN_CATEGORIES.map((c) => c.id);
  const category = (j.category ?? "tools") as PluginCategory;
  if (!categories.includes(category)) errors.push(`\`category\` must be one of: ${categories.join(", ")}.`);

  const perms = readPermissions(j.permissions ?? {});
  if (!perms.ok) errors.push(...perms.errors);

  const config: Record<string, ConfigProperty> = {};
  if (j.config !== undefined) {
    if (typeof j.config !== "object" || j.config === null || Array.isArray(j.config)) errors.push("`config` must be an object: { \"key\": { type, title, default, … } }.");
    else {
      const entries = Object.entries(j.config as Record<string, unknown>);
      if (entries.length > MAX.config) errors.push(`\`config\` has too many settings (${MAX.config} at most).`);
      for (const [key, value] of entries) {
        const r = readConfigProperty(key, value);
        if (typeof r === "string") errors.push(r);
        else config[key] = r;
      }
    }
  }

  let view: { title: string; description: string } | null = null;
  if (j.view !== undefined && j.view !== null) {
    const v = j.view as Record<string, unknown>;
    const title = text(v?.title);
    const about = text(v?.description);
    if (typeof j.view !== "object" || !title || !about) errors.push("`view` must be { \"title\": …, \"description\": … } — or null when the plugin has no tab.");
    else if (title.length > MAX.viewTitle || about.length > MAX.viewDescription) errors.push(`\`view.title\` (${MAX.viewTitle}) or \`view.description\` (${MAX.viewDescription}) is too long.`);
    else view = { title, description: about };
  }

  if (errors.length) return { ok: false, errors };
  const permissions = perms.ok ? perms.value : EMPTY_PERMISSIONS;
  const manifest: PluginManifest = {
    id,
    name,
    version,
    tier: "user",
    category,
    summary,
    forAgents,
    description: description || summary,
    requires: [],
    /* Its jobs run on the core's clock: no other plugin needed. */
    optional: [],
    needs: [],
    config: { type: "object", properties: config, additionalProperties: false },
    views: view ? [{ id, ...view }] : [],
    data: "What the plugin saves itself, in its own folder.",
  };
  return { ok: true, value: { manifest, permissions } };
}

function readConfigProperty(key: string, raw: unknown): ConfigProperty | string {
  const where = `\`config.${key}\``;
  if (!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(key)) return `${where}: a setting's key is a plain identifier (letters and digits).`;
  if (typeof raw !== "object" || raw === null) return `${where} must be an object: { type, title, default }.`;
  const p = raw as Record<string, unknown>;
  const type = p.type;
  if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") return `${where}.type must be string, number, integer or boolean.`;
  const title = text(p.title);
  if (!title) return `${where}.title is required: what the user reads in the settings.`;
  const prop: ConfigProperty = { type, title, default: p.default as ConfigProperty["default"] };
  if (typeof p.description === "string") prop.description = p.description.trim();
  if (Array.isArray(p.enum)) prop.enum = p.enum.filter((x): x is string | number => typeof x === "string" || typeof x === "number");
  if (Array.isArray(p.enumLabels)) prop.enumLabels = p.enumLabels.map(String);
  if (typeof p.minimum === "number") prop.minimum = p.minimum;
  if (typeof p.maximum === "number") prop.maximum = p.maximum;
  if (p.format === "time" || p.format === "frequency" || p.format === "agent") prop.format = p.format;
  if (!validValue(prop, prop.default)) return `${where}.default is missing or does not fit its own type/limits.`;
  return prop;
}
