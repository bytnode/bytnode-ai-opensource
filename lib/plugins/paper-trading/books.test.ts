import { describe, expect, it } from "vitest";
import { addBook, bookFile, findBook, listOrDefault, removeBook, renameBook, type PaperBook } from "./books";

const now = new Date("2026-09-24T10:00:00.000Z");
const main = listOrDefault(null, now);
const two = addBook(main, "Swing BTC", "a1b2c3d4", now) as PaperBook[];

describe("the paper portfolios", () => {
  it("before any is created, the historic book alone, in its own file", () => {
    expect(main).toEqual([{ id: "default", name: "Main", createdAt: now.toISOString() }]);
    expect(bookFile("default")).toBe("default.json");
    expect(bookFile("a1b2c3d4")).toBe("book-a1b2c3d4.json");
  });

  it("finds a book by id or name, the first when none is named", () => {
    expect(findBook(two, undefined)).toBe(two[0]);
    expect(findBook(two, "  swing btc ")).toBe(two[1]);
    expect(findBook(two, "a1b2c3d4")).toBe(two[1]);
    expect(findBook(two, "Scalp")).toEqual({ error: 'No paper portfolio "Scalp". There are: Main, Swing BTC.' });
  });

  it("names are unique and bounded", () => {
    expect(addBook(two, "swing BTC", "x", now)).toEqual({ error: 'There is already a paper portfolio named "swing BTC".' });
    expect(addBook(two, "  ", "x", now)).toEqual({ error: "Give the portfolio a name." });
    expect(renameBook(two, "a1b2c3d4", "Swing  BTC")).toEqual(two);
    expect(renameBook(two, "a1b2c3d4", "Main")).toEqual({ error: 'There is already a paper portfolio named "Main".' });
    expect((renameBook(two, "default", "Long term") as PaperBook[])[0].name).toBe("Long term");
  });

  it("never deletes the last one", () => {
    expect(removeBook(two, "default")).toEqual([two[1]]);
    expect(removeBook([two[1]], "a1b2c3d4")).toEqual({ error: "The last paper portfolio cannot be deleted: reset it instead." });
    expect(removeBook(two, "nope")).toEqual({ error: "This paper portfolio no longer exists." });
  });
});
