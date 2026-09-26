import type { PluginNeed } from "@/lib/domain/plugins";

/* ---------------------------------------------------------------------------
   The « Your BytNode-AI plugins » section of an agent's prompt. Pure.

   Without it an agent saw a flat list of tools and a few anonymous context
   blocks: asked "which plugins do you have?", a subscription agent (Claude
   Code, Codex…) answered with its own client's notion of a plugin, or with
   MCP servers and skills, because nothing told it what a plugin is HERE. So
   the section says it plainly: what a plugin is and is not, which ones this
   agent has (name, what it is for, its tools, its tab), which ones it has
   not and why, how to use them — then each plugin's own notes under its
   name. Rebuilt at every turn from what really runs.
--------------------------------------------------------------------------- */

export type PluginEntry = {
  name: string;
  /** What it is for, in full sentences (the manifest's `forAgents`). */
  about: string;
  /** Its tools this agent may call. */
  tools: string[];
  /** The titles of its tabs. */
  tabs: string[];
  /** Its own sections — how to use it, what it holds now — as written. */
  context: string[];
};

export type Absence = { kind: "off" } | { kind: "need"; need: PluginNeed } | { kind: "failed"; message?: string };

export type PluginAbsent = { name: string; about: string; why: Absence };

export type PluginsPromptInput = {
  /** `mcp`: a subscription agent, reaching the tools through `bytnode-ai`. */
  engine: "native" | "mcp";
  /** A sub-agent or a background run: no tabs, nobody to switch a plugin on. */
  subagent: boolean;
  on: PluginEntry[];
  absent: PluginAbsent[];
};

/** A plugin's own headings sit under its name: `## X` becomes `#### X`. */
const demote = (text: string) => text.replace(/^(#{1,4}) /gm, (_, h: string) => `${"#".repeat(h.length + 2)} `);

const why = (a: Absence): string => {
  switch (a.kind) {
    case "off":
      return "switched off for you — the user can switch it on in Settings → Plugins";
    case "need":
      return a.need === "exchange-account"
        ? "needs an exchange account attached to you — the user adds one in Settings, then ticks it in your agent's settings"
        : "needs a BytNode key — the user sets it in Settings";
    case "failed":
      return `switched on but could not start${a.message ? ` (${a.message})` : ""} — tell the user`;
  }
};

const entryLine = (p: PluginEntry, withTabs: boolean): string => {
  const parts = [`- **${p.name}** — ${p.about}`];
  parts.push(p.tools.length ? `Tools: ${p.tools.join(", ")}.` : "No tool of its own (context only).");
  if (withTabs && p.tabs.length) parts.push(`Tab: ${p.tabs.join(", ")}.`);
  return parts.join(" ");
};

const contextBlocks = (on: PluginEntry[]): string[] =>
  on.filter((p) => p.context.length).map((p) => [`### ${p.name}`, ...p.context.map(demote)].join("\n"));

export function pluginsPrompt(input: PluginsPromptInput): string {
  return input.subagent ? subagentSection(input) : mainSection(input);
}

function mainSection({ engine, on, absent }: PluginsPromptInput): string {
  const tabs = on.some((p) => p.tabs.length > 0);
  const lines = [
    "## Your BytNode-AI plugins",
    "",
    "A plugin is a module of BytNode-AI that the user switches on or off in Settings → Plugins, agent by agent. A plugin can bring three things: tools you call (listed with it below); a tab — a page of the app that the user opens beside this chat, showing the very data your tools read and write; and its own notes — how to use it and, for some, what it holds right now (its section after this list, refreshed at every message).",
    "Plugins are not skills, not MCP servers, and not the plugins or extensions of your own client. When the user says \"plugin\", they mean the ones below.",
    "",
  ];
  if (on.length) {
    lines.push(`Switched on for you (${on.length}):`, ...on.map((p) => entryLine(p, true)));
  } else {
    lines.push("No plugin is switched on for you: you have the core tools only.");
  }
  if (absent.length) {
    lines.push("", "Not available to you:", ...absent.map((a) => `- ${a.name}: ${why(a.why)}. (${a.about})`));
  }
  lines.push(
    "",
    "How to work with them:",
    "- Asked which plugins you have, or what you can do here: answer from this list, plugin by plugin, saying what each one does for the user. Do not answer with a bare list of tool names, nor with your client's own tools, plugins or MCP servers.",
    `- A request that a plugin covers goes through that plugin's tools, never a script or a file of your own: the user sees the result in the app${tabs ? ", in that plugin's tab" : ""}. Read its current state with its tools before you change it.`,
  );
  if (tabs) lines.push("- After a change the user will want to see, offer to open the plugin's tab; OpenView opens it for them.");
  lines.push("- A request that needs a plugin you do not have: name the plugin and say where the user switches it on. Do not improvise a substitute.");
  lines.push(
    "- A request no plugin covers — a new tool, a new tab, a watch that warns them: you can WRITE a plugin for the user. Load the `create-plugin` skill first; it starts with questions to the user. Plugins written by agents are listed here like the others once the user approved them.",
  );
  if (engine === "mcp") {
    lines.push(
      "- These tools reach you through the `bytnode-ai` MCP server, so your client may list them with a prefix (in Claude Code, `mcp__bytnode-ai__WatchlistShow`). This prompt names them without it: they are the same tools.",
    );
  }
  const blocks = contextBlocks(on);
  return [lines.join("\n"), ...blocks].join("\n\n");
}

function subagentSection({ engine, on }: PluginsPromptInput): string {
  const usable = on.filter((p) => p.tools.length || p.context.length);
  if (!usable.length) return "";
  const lines = [
    "## BytNode-AI plugins",
    "",
    "Some of your tools come from BytNode-AI's plugins — modules the user switches on in the app (they are neither skills nor MCP servers). Their data is the user's own, shared with the app: use their tools for what they cover rather than a script.",
    ...usable.map((p) => entryLine(p, false)),
    "The tools listed here are the ones you have; a plugin's notes below may name others, kept for the main agent.",
  ];
  if (engine === "mcp") lines.push("They reach you through the `bytnode-ai` MCP server; your client may show them with a prefix (`mcp__bytnode-ai__…`).");
  return [lines.join("\n"), ...contextBlocks(usable)].join("\n\n");
}
