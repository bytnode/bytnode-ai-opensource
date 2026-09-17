import { describe, expect, test } from "vitest";
import { run } from "./run";

/* Le lecteur ligne a ligne ne doit pas garder en memoire un flux sans
   retour a la ligne : au-dela d'une borne, la ligne est livree telle
   quelle. */
describe("run : lignes", () => {
  test("une tres longue ligne sans fin est livree par morceaux bornes", async () => {
    const lines: string[] = [];
    const r = await run(process.execPath, ["-e", "process.stdout.write('x'.repeat(2_500_000))"], {
      cwd: process.cwd(),
      timeoutMs: 30_000,
      onLine: (l) => lines.push(l),
      maxBytes: 100,
    });
    expect(r.code).toBe(0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    /* La borne, plus au plus un morceau de flux. */
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(1_500_000);
    /* Et la sortie gardee reste bornee par maxBytes (a un morceau pres). */
    expect(r.stdout.length).toBeLessThan(2_500_000);
  });
});
