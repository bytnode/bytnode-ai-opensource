/* ---------------------------------------------------------------------------
   The composer's commands.

   A message that starts with `/` may be a command. While it is being
   typed, the composer proposes the ones that start the same way, with a
   word of explanation — for whoever does not know they exist. As soon as
   a space follows the name, the command is complete (what follows is its
   instructions) and the proposal disappears.

   Pure: the list and the matching. Execution stays in `use-chat.ts`
   (`isCompactCommand`).
--------------------------------------------------------------------------- */

export type SlashCommand = {
  /** The name, without the slash: `compact`. */
  name: string;
  /** What may follow, as shown: `[instructions]`. */
  args?: string;
  /** A word of explanation, for the list. */
  description: string;
};

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: "compact",
    args: "[instructions]",
    description: "Replace the thread with a summary: the agent keeps what matters, the conversation gets lighter",
  },
];

/** The commands to propose for what is typed: `/`, `/c`, `/comp`…
    Nothing if the text does not start with `/`, or as soon as a space
    follows the name — the command is then complete. Case-insensitive. */
export function matchCommands(text: string, commands: readonly SlashCommand[] = COMMANDS): SlashCommand[] {
  const m = text.match(/^\/(\S*)$/);
  if (!m) return [];
  const prefix = m[1].toLowerCase();
  return commands.filter((c) => c.name.startsWith(prefix));
}

/** Is the text a known command (`/compact`, `/compact keep…`)? A command
    is not a message: attachments and deep research do not go with it. */
export function isCommandText(text: string, commands: readonly SlashCommand[] = COMMANDS): boolean {
  const m = text.trim().match(/^\/(\S+)/);
  return !!m && commands.some((c) => c.name === m[1].toLowerCase());
}

/** What the field becomes when a command is completed (Tab): its name,
    and a space to add instructions. */
export const completeCommand = (c: SlashCommand) => `/${c.name} `;

/** What is sent when it is run from the list (Enter): the command alone. */
export const runCommand = (c: SlashCommand) => `/${c.name}`;
