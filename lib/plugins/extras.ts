import { listSkillsIn, type SkillInfo } from "@/lib/tools/skills/skill";
import { resolvePolicy } from "@/lib/tools/policy";
import type { PluginManifest, PluginStatus } from "@/lib/domain/plugins";
import type { PromptTarget } from "./core/contract";
import type { AgentNeeds, PluginRuntime } from "./core/runtime";
import { pluginsPrompt, type Absence } from "./overview";

/* What the plugins enabled for an agent add around its tools: skills, and
   prompt sections. SERVER-ONLY (the skills are read from disk). */

/** The skills of the plugins enabled for an agent. */
export async function pluginSkills(runtime: PluginRuntime, plugins: string[] | null): Promise<SkillInfo[]> {
  return (await Promise.all(runtime.skillDirs(plugins).map(listSkillsIn))).flat();
}

/** Why an agent does not have a plugin. */
function absence(manifest: PluginManifest, status: PluginStatus | undefined, plugins: string[] | null, needs: AgentNeeds): Absence {
  if (status?.state === "error" || status?.state === "blocked") return { kind: "failed", message: status.message };
  const forThisAgent = status?.state === "active" && (plugins === null || plugins.includes(manifest.id));
  const unmet = manifest.needs.find((n) => needs[n] !== true);
  return forThisAgent && unmet ? { kind: "need", need: unmet } : { kind: "off" };
}

/** The agent's « Your BytNode-AI plugins » section: which plugins it has
    (their tools and tabs), which it has not and why, then each one's live
    context under its name — re-read at every turn: a watchlist, the coming
    events change between two. */
export async function pluginPrompt(runtime: PluginRuntime, plugins: string[] | null, target: PromptTarget, needs: AgentNeeds): Promise<string> {
  const mine = runtime.forAgent(plugins, needs);
  const sections = await runtime.promptSections(plugins, target, needs);
  const status = new Map(runtime.status().map((s) => [s.id, s]));
  const byId = new Map(runtime.manifests.map((m) => [m.id, m]));
  const on = mine.map((id) => {
    const m = byId.get(id)!;
    const tools = runtime.toolsOf(id).filter((t) => !target.subagent || resolvePolicy(t.name, t.policy).subagent);
    return {
      name: m.name,
      about: m.forAgents,
      tools: tools.map((t) => t.name),
      tabs: m.views.map((v) => v.title),
      context: sections.filter((s) => s.id === id).map((s) => s.text),
    };
  });
  const absent = runtime.manifests
    .filter((m) => !mine.includes(m.id))
    .map((m) => ({ name: m.name, about: m.forAgents, why: absence(m, status.get(m.id), plugins, needs) }));
  return pluginsPrompt({ engine: target.engine, subagent: target.subagent, on, absent });
}
