import { listSkillsIn, type SkillInfo } from "@/lib/tools/skills/skill";
import type { PromptTarget } from "./core/contract";
import type { AgentNeeds, PluginRuntime } from "./core/runtime";

/* What the plugins enabled for an agent add around its tools: skills, and
   prompt sections. SERVER-ONLY (the skills are read from disk). */

/** The skills of the plugins enabled for an agent. */
export async function pluginSkills(runtime: PluginRuntime, plugins: string[] | null): Promise<SkillInfo[]> {
  return (await Promise.all(runtime.skillDirs(plugins).map(listSkillsIn))).flat();
}

/** What the plugins enabled for an agent add to its prompt — re-read at
    every turn: a watchlist, the coming events change between two. */
export async function pluginPrompt(runtime: PluginRuntime, plugins: string[] | null, target: PromptTarget, needs: AgentNeeds): Promise<string> {
  return (await runtime.prompts(plugins, target, needs)).join("\n\n");
}
