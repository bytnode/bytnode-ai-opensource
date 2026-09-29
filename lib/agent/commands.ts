/* ---------------------------------------------------------------------------
   The composer's commands.

   A message that starts with `/` may be a command. While it is being
   typed, the composer proposes the ones that start the same way, with a
   word of explanation — for whoever does not know they exist. As soon as
   a space follows the name, the command is complete (what follows is its
   instructions) and the proposal disappears.

   Two sources: BytNode-AI's own (`COMMANDS`: `/compact`), and those a
   subscription agent publishes for itself — Claude Code's `/goal`,
   `/usage`, `/context`…, Codex's `/review`, `/status` and its `$skill`s,
   Gemini CLI's `/memory show`… (`lib/acp/commands.ts`). The agent's are sent
   to it as typed, so they behave as in its own terminal.

   Pure: the lists and the matching. Execution stays in `use-chat.ts`
   (`isCompactCommand`) and, for an agent's own, in the agent.
--------------------------------------------------------------------------- */

export type SlashCommand = {
  /** The name, without its trigger: `compact`, `memory show` (Gemini's
      sub-commands carry a space), `pdf:pdf` (a Codex skill). */
  name: string;
  /** What may follow, as shown: `[instructions]`. */
  args?: string;
  /** A word of explanation, for the list. */
  description: string;
  /** What starts it: `/` (the default), or `$` for a Codex skill. */
  trigger?: "/" | "$";
  /** Who runs it, when it is not BytNode-AI: « Claude Code », « Codex »… */
  source?: string;
};

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: "compact",
    args: "[instructions]",
    description: "Replace the thread with a summary: the agent keeps what matters, the conversation gets lighter",
  },
];

const triggerOf = (c: SlashCommand) => c.trigger ?? "/";
const lower = (s: string) => s.toLowerCase();

/** The commands to propose for what is typed: `/`, `/c`, `/comp`…
    Nothing if the text does not start with a trigger, or once the command
    is complete: a space closes the list, unless a longer name still starts
    with what is typed (`/memory ` → `memory show`, `memory list`…).
    Names that START with the text come first; from two characters on,
    names that merely contain it follow (`/review` → `code-review`), as in
    the agents' own terminals. Case-insensitive. */
export function matchCommands(text: string, commands: readonly SlashCommand[] = COMMANDS): SlashCommand[] {
  const m = text.match(/^([/$])([^\n]*)$/);
  if (!m) return [];
  const typed = lower(m[2]);
  const pool = commands.filter((c) => triggerOf(c) === m[1]);
  const starts = pool.filter((c) => lower(c.name).startsWith(typed));
  if (/\s/.test(typed)) return starts.filter((c) => lower(c.name) !== typed.trimEnd());
  const contains = typed.length >= 2 ? pool.filter((c) => !lower(c.name).startsWith(typed) && lower(c.name).includes(typed)) : [];
  return [...starts, ...contains];
}

/** The command the text runs, if any: the longest known name its first
    words spell (`/memory show` rather than `/memory`), then what follows. */
export function commandOf(text: string, commands: readonly SlashCommand[] = COMMANDS): { command: SlashCommand; rest: string } | null {
  const t = text.trim();
  const m = t.match(/^([/$])(\S[\s\S]*)$/);
  if (!m) return null;
  const words = m[2].split(/\s+/);
  for (let n = words.length; n >= 1; n--) {
    const name = lower(words.slice(0, n).join(" "));
    const command = commands.find((c) => triggerOf(c) === m[1] && lower(c.name) === name);
    if (command) return { command, rest: words.slice(n).join(" ") };
  }
  return null;
}

/** Is the text a known command (`/compact`, `/compact keep…`)? A command
    is not a message: attachments and deep research do not go with it. */
export const isCommandText = (text: string, commands: readonly SlashCommand[] = COMMANDS): boolean => commandOf(text, commands) !== null;

/** What the field becomes when a command is completed (Tab): its name,
    and a space to add instructions. */
export const completeCommand = (c: SlashCommand) => `${triggerOf(c)}${c.name} `;

/** What is sent when it is run from the list (Enter): the command alone. */
export const runCommand = (c: SlashCommand) => `${triggerOf(c)}${c.name}`;

/** Who runs a command without a `source`: BytNode-AI itself. */
export const OWN_SOURCE = "BytNode-AI";

/** The matches grouped under who runs them, each group where its first
    match falls — the list reads « BytNode-AI », then « Claude Code »,
    instead of repeating the name on every row. `flat` is the order shown:
    the keyboard walks it. */
export function groupBySource(list: readonly SlashCommand[]): { groups: Array<{ source: string; items: SlashCommand[] }>; flat: SlashCommand[] } {
  const groups: Array<{ source: string; items: SlashCommand[] }> = [];
  for (const c of list) {
    const source = c.source ?? OWN_SOURCE;
    const group = groups.find((g) => g.source === source);
    if (group) group.items.push(c);
    else groups.push({ source, items: [c] });
  }
  return { groups, flat: groups.flatMap((g) => g.items) };
}

/** The composer's list for an agent: BytNode-AI's own commands, then the
    agent's. An agent's command of the same name wins — `/compact` then
    compacts the agent's OWN session, as in its terminal. */
export function mergeCommands(agent: readonly SlashCommand[], own: readonly SlashCommand[] = COMMANDS): SlashCommand[] {
  const taken = new Set(agent.map((c) => `${triggerOf(c)}${lower(c.name)}`));
  return [...own.filter((c) => !taken.has(`${triggerOf(c)}${lower(c.name)}`)), ...agent];
}
