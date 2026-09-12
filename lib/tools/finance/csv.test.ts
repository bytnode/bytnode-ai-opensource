import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, rowsOf, detectColumns, coerceNumber } from "./csv";

describe("parseCsv / toCsv", () => {
  it("lit un CSV simple avec en-tete", () => {
    const t = parseCsv("time,open,close\n2024-01-01,1,2\n2024-01-02,2,3\n");
    expect(t.columns).toEqual(["time", "open", "close"]);
    expect(t.rows).toEqual([
      { time: "2024-01-01", open: 1, close: 2 },
      { time: "2024-01-02", open: 2, close: 3 },
    ]);
  });

  it("gere les champs entre guillemets et les virgules internes", () => {
    const t = parseCsv('a,b\n"x, y",1\n');
    expect(t.rows[0]).toEqual({ a: "x, y", b: 1 });
  });

  it("ecrit un CSV stable, colonnes dans l'ordre", () => {
    const csv = toCsv(["time", "close"], [{ time: "2024-01-01", close: 1.5 }, { time: "2024-01-02", close: 2 }]);
    expect(csv).toBe("time,close\n2024-01-01,1.5\n2024-01-02,2\n");
  });
});

describe("rowsOf", () => {
  it("trouve un tableau d'objets a la racine", () => {
    expect(rowsOf([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("le trouve sous une cle (data, candles, result…)", () => {
    expect(rowsOf({ status: "ok", data: { candles: [{ t: 1 }] } })).toEqual([{ t: 1 }]);
  });

  it("convertit un tableau de tableaux avec en-tete declaree", () => {
    expect(rowsOf({ columns: ["t", "c"], values: [[1, 2], [3, 4]] })).toEqual([
      { t: 1, c: 2 },
      { t: 3, c: 4 },
    ]);
  });

  it("convertit un tableau de tableaux OHLCV sans en-tete (forme exchange)", () => {
    const rows = rowsOf([[1700000000000, 1, 2, 0.5, 1.5, 100]]);
    expect(rows).toEqual([{ time: 1700000000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
  });

  it("prefere le plus grand tableau aux metadonnees qui l'accompagnent", () => {
    const rows = rowsOf({ meta: [{ source: "x" }, { source: "y" }], result: { count: 3, klines: [[1, 1, 2, 0.5, 1.5, 9], [2, 1, 2, 0.5, 1.5, 9], [3, 1, 2, 0.5, 1.5, 9]] } });
    expect(rows?.length).toBe(3);
    expect(rows?.[0].close).toBe(1.5);
  });

  it("rend null quand il n'y a rien de tabulaire", () => {
    expect(rowsOf({ message: "hello" })).toBeNull();
  });
});

describe("detectColumns", () => {
  it("reconnait les colonnes OHLCV par leurs noms usuels", () => {
    const c = detectColumns(["timestamp", "o", "h", "l", "c", "vol"]);
    expect(c).toEqual({ time: "timestamp", open: "o", high: "h", low: "l", close: "c", volume: "vol" });
  });

  it("accepte une serie sans OHLC (prix seul)", () => {
    const c = detectColumns(["date", "price"]);
    expect(c.time).toBe("date");
    expect(c.close).toBe("price");
    expect(c.open).toBeUndefined();
  });
});

describe("coerceNumber", () => {
  it("convertit les nombres ecrits en texte, laisse le reste", () => {
    expect(coerceNumber("1.5")).toBe(1.5);
    expect(coerceNumber("2024-01-01")).toBe("2024-01-01");
    expect(coerceNumber("")).toBe("");
  });
});
