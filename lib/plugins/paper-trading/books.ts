/* ---------------------------------------------------------------------------
   The paper portfolios: several simulated books, each with its name.

   The list lives in `portfolios.json` (id, name, when); each book in its
   own file. The FIRST book of the list is the default one — what an agent
   trades when it names none, what the DCA buys into. Before any portfolio
   is created, the list is only the historic book (`default.json`), named
   "Main": it keeps working untouched, and is written into the list the
   first time the list changes. Pure, tested.
--------------------------------------------------------------------------- */

export type PaperBook = { id: string; name: string; createdAt: string };

export const INDEX = "portfolios.json";
export const DEFAULT_ID = "default";
export const DEFAULT_NAME = "Main";
export const MAX_BOOKS = 12;
const NAME_MAX = 40;

/** The file of a book: the historic one keeps its name. */
export const bookFile = (id: string): string => (id === DEFAULT_ID ? "default.json" : `book-${id}.json`);

/** The list as stored, or the historic book alone. */
export const listOrDefault = (stored: PaperBook[] | null | undefined, now: Date): PaperBook[] => (stored && stored.length ? stored : [{ id: DEFAULT_ID, name: DEFAULT_NAME, createdAt: now.toISOString() }]);

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A book by its id or its name (any case); none named: the default one. */
export function findBook(list: PaperBook[], ref?: string | null): PaperBook | { error: string } {
  const r = ref?.trim();
  if (!r) return list[0];
  const found = list.find((b) => b.id === r) ?? list.find((b) => same(b.name, r));
  return found ?? { error: `No paper portfolio "${r}". There are: ${list.map((b) => b.name).join(", ")}.` };
}

/** A name a book may take: 1–40 characters, not another book's. */
export function checkName(list: PaperBook[], raw: string, except?: string): string | { error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the portfolio a name." };
  if (name.length > NAME_MAX) return { error: `A name of ${NAME_MAX} characters at most.` };
  if (list.some((b) => b.id !== except && same(b.name, name))) return { error: `There is already a paper portfolio named "${name}".` };
  return name;
}

export function addBook(list: PaperBook[], name: string, id: string, now: Date): PaperBook[] | { error: string } {
  if (list.length >= MAX_BOOKS) return { error: `${MAX_BOOKS} paper portfolios at most: delete one first.` };
  const checked = checkName(list, name);
  if (typeof checked !== "string") return checked;
  return [...list, { id, name: checked, createdAt: now.toISOString() }];
}

export function renameBook(list: PaperBook[], id: string, name: string): PaperBook[] | { error: string } {
  if (!list.some((b) => b.id === id)) return { error: "This paper portfolio no longer exists." };
  const checked = checkName(list, name, id);
  if (typeof checked !== "string") return checked;
  return list.map((b) => (b.id === id ? { ...b, name: checked } : b));
}

export function removeBook(list: PaperBook[], id: string): PaperBook[] | { error: string } {
  if (!list.some((b) => b.id === id)) return { error: "This paper portfolio no longer exists." };
  if (list.length === 1) return { error: "The last paper portfolio cannot be deleted: reset it instead." };
  return list.filter((b) => b.id !== id);
}
