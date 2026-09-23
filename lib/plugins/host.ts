import path from "node:path";
import type { PluginsState } from "@/lib/domain/plugins";
import { bytnodeAiTools, generalTools } from "@/lib/tools/registry";
import { OPEN_VIEW } from "@/lib/tools/views/open-view";
import { PLUGINS } from "./definitions";
import { setActiveRuntime } from "./core/active";
import { requestConfirmation } from "./core/confirmations";
import { listSkillsIn, type SkillInfo } from "@/lib/tools/skills/skill";
import type { PromptTarget, Session } from "./core/contract";
import { addNotification } from "./core/notifications";
import { PluginRuntime, type AgentNeeds, type RuntimeEnv } from "./core/runtime";
import { SessionHolder } from "./core/session";
import { pluginStore, pluginsDir, readJson, writeJsonAtomic } from "./core/store";

/* ---------------------------------------------------------------------------
   Where the plugin runtime lives.

   - The Next server has ONE host (`pluginHost`), kept on `globalThis`: the
     runtime with the background, the session's keys in memory, and the
     plugins' state. That state comes from the browser's settings (sent
     with the session); a copy without any secret is kept on disk
     (`plugins/state.json`) so a restart knows which plugins to start before
     a tab speaks.
   - The MCP server of a subscription session starts a runtime of its own
     (`startToolsRuntime`): the same plugins, tools only, no background.
--------------------------------------------------------------------------- */

const KEY = Symbol.for("bytnode-ai.plugins.host");

export type Host = {
  runtime: PluginRuntime;
  session: SessionHolder;
  /** The first `apply` (from the disk copy): awaited before serving. */
  ready: Promise<void>;
};

const mirrorFile = () => path.join(pluginsDir(), "state.json");

/** The names no plugin may take: every core tool, and OpenView. */
function coreToolNames(): Set<string> {
  const account = { id: "", exchange: "binance", label: "", apiKey: "", secret: "", password: "", testnet: true };
  return new Set([...generalTools(process.platform), ...bytnodeAiTools({ exchangeAccounts: [account] })].map((t) => t.name).concat(OPEN_VIEW));
}

function env(background: boolean, session: () => Session | null): RuntimeEnv {
  return {
    background,
    reservedNames: coreToolNames(),
    store: (id) => pluginStore(id),
    notifications: { add: addNotification },
    confirmations: { request: requestConfirmation },
    session,
    log: (message) => console.info(message),
  };
}

type Holder = { [KEY]?: Host };

export function pluginHost(): Host {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];
  const session = new SessionHolder();
  const runtime = new PluginRuntime(PLUGINS, env(true, () => session.get()));
  setActiveRuntime(runtime);
  const ready = readJson<PluginsState>(mirrorFile(), {}).then((state) => runtime.apply(state));
  const host: Host = { runtime, session, ready };
  holder[KEY] = host;
  return host;
}

/** The runtime, once it has started what the disk copy says. */
export async function readyRuntime(): Promise<PluginRuntime> {
  const host = pluginHost();
  await host.ready;
  return host.runtime;
}

/** A tab speaks: its keys for the background, and the plugins' state —
    applied, and copied to disk when it changed. */
export async function syncSession(session: Session): Promise<void> {
  const host = pluginHost();
  await host.ready;
  host.session.set(session);
  const previous = await readJson<PluginsState>(mirrorFile(), {});
  if (JSON.stringify(previous) !== JSON.stringify(session.plugins)) await writeJsonAtomic(mirrorFile(), session.plugins);
  await host.runtime.apply(session.plugins);
}

/** The skills of the plugins enabled for an agent. */
export async function pluginSkills(runtime: PluginRuntime, plugins: string[] | null): Promise<SkillInfo[]> {
  return (await Promise.all(runtime.skillDirs(plugins).map(listSkillsIn))).flat();
}

/** What the plugins enabled for an agent add to its prompt — re-read at
    every turn: a watchlist, the coming events change between two. */
export async function pluginPrompt(runtime: PluginRuntime, plugins: string[] | null, target: PromptTarget, needs: AgentNeeds): Promise<string> {
  return (await runtime.prompts(plugins, target, needs)).join("\n\n");
}

/** The runtime of an MCP server: tools only, for the state it was given. */
export async function startToolsRuntime(state: PluginsState): Promise<PluginRuntime> {
  const runtime = new PluginRuntime(PLUGINS, env(false, () => null));
  setActiveRuntime(runtime);
  await runtime.apply(state);
  return runtime;
}
