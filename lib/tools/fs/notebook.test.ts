import { describe, expect, test } from "vitest";
import { editNotebook } from "./notebook-edit";

const nb = () => ({
  cells: [
    { cell_type: "code", source: ["print(1)\n"], metadata: {}, outputs: [], execution_count: null },
    { cell_type: "markdown", source: ["# Title"], metadata: {} },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

describe("editNotebook", () => {
  test("replaces a cell's source", () => {
    const out = editNotebook(nb(), { cell_index: 0, edit_mode: "replace", new_source: "print(2)" });
    expect(out.ok && out.notebook.cells[0].source).toEqual(["print(2)"]);
  });

  test("inserts a cell after the index, with a type", () => {
    const out = editNotebook(nb(), { cell_index: 0, edit_mode: "insert", new_source: "x = 1", cell_type: "code" });
    expect(out.ok && out.notebook.cells.length).toBe(3);
    expect(out.ok && out.notebook.cells[1]).toMatchObject({ cell_type: "code", source: ["x = 1"], outputs: [] });
  });

  test("deletes a cell", () => {
    const out = editNotebook(nb(), { cell_index: 1, edit_mode: "delete" });
    expect(out.ok && out.notebook.cells.length).toBe(1);
  });

  test("refuses an index out of range", () => {
    expect(editNotebook(nb(), { cell_index: 5, edit_mode: "replace", new_source: "x" })).toMatchObject({ ok: false });
  });

  test("splits multi-line source into lines that keep their newline", () => {
    const out = editNotebook(nb(), { cell_index: 0, edit_mode: "replace", new_source: "a\nb" });
    expect(out.ok && out.notebook.cells[0].source).toEqual(["a\n", "b"]);
  });
});
