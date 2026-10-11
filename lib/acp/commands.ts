import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { commandOf, type SlashCommand } from "@/lib/agent/commands";

/* ---------------------------------------------------------------------------
   A subscription agent's own commands, as BytNode-AI's composer offers them.

   Every agent publishes its list through ACP (`available_commands_update`)
   as soon as a session opens, and again when it changes (skills reloaded,
   a plugin installed): Claude Code its built-in commands and its skills
   (`/goal`, `/usage`, `/context`, `/model`, `/code-review`…, and the
   workspace's skills — the profession's, synced into `.claude/skills`),
   Codex its commands and its skills as `$name`; a command may have
   sub-commands (`memory show`). Pure: shared browser / server.
--------------------------------------------------------------------------- */

/** The agent's list in the composer's shape. Names starting with `__` are
    the agent's internal plumbing (Claude Code's `__remote-workflow`), not
    for a user. A Codex skill (`$pdf:pdf`) keeps its `$` as its trigger. */
export function agentCommands(list: readonly AvailableCommand[], source?: string): SlashCommand[] {
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const raw = typeof c?.name === "string" ? c.name.trim() : "";
    const trigger = raw.startsWith("$") ? "$" : "/";
    const name = raw.replace(/^[/$]/, "");
    if (!name || name.startsWith("__")) continue;
    const key = `${trigger}${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hint = c.input && "hint" in c.input && typeof c.input.hint === "string" ? c.input.hint.trim() : "";
    out.push({
      name,
      description: (c.description ?? "").trim(),
      ...(hint ? { args: hint } : {}),
      ...(trigger === "$" ? { trigger } : {}),
      ...(source ? { source } : {}),
    });
  }
  return out;
}

/** Does this message run one of the agent's `/` commands? Such a message
    goes to the agent EXACTLY as typed: Codex only reads a command in the
    prompt's first block, Claude Code the start of it — BytNode-AI's context wrapped around it (`wrapContext`)
    turned `/goal …` into an ordinary message. With no list known yet (a
    session whose list has not arrived), a `/word` counts as a command.
    A `$skill` is not one: the agent reads it inside an ordinary message. */
export function isAgentCommandText(text: string, known: readonly SlashCommand[] | null): boolean {
  const t = text.trim();
  if (!t.startsWith("/")) return false;
  const slash = (known ?? []).filter((c) => (c.trigger ?? "/") === "/");
  if (slash.length === 0) return /^\/[A-Za-z][\w:.-]*(\s|$)/.test(t);
  return commandOf(t, slash) !== null;
}
