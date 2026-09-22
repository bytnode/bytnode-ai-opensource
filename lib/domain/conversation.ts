const TITLE_MAX = 44;

/** A conversation's title: its first line, cut on a word. */
export function deriveTitle(firstMessage: string): string {
  const line = firstMessage.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!line) return "New conversation";
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
