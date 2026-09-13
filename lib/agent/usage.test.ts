import { describe, expect, it } from "vitest";
import { PROMPT_OVERHEAD, contextEstimate, estimateTokens, fmtCost, fmtTokens, mergeUsage, rate, usageState } from "./usage";

describe("estimateTokens", () => {
  it("estime a partir des caracteres, français compris", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBeGreaterThan(80);
    expect(estimateTokens("a".repeat(400))).toBeLessThan(140);
  });
});

describe("mergeUsage", () => {
  it("garde le dernier decompte connu, champ par champ", () => {
    const a = mergeUsage(undefined, { input: 100, provider: "Modal" });
    expect(a).toEqual({ input: 100, provider: "Modal" });
    expect(mergeUsage(a, { output: 20 })).toEqual({ input: 100, output: 20, provider: "Modal" });
  });

  it("additionne les couts de plusieurs tours", () => {
    const a = mergeUsage(undefined, { cost: 0.01 });
    expect(mergeUsage(a, { cost: 0.02 }, { addCost: true })?.cost).toBeCloseTo(0.03);
    expect(mergeUsage(a, { cost: 0.02 })?.cost).toBeCloseTo(0.02);
  });
});

describe("usageState", () => {
  it("deduit le contexte des jetons d'entree et de sortie", () => {
    const s = usageState({ input: 8_000, output: 2_000 }, 200_000);
    expect(s.context).toBe(10_000);
    expect(s.window).toBe(200_000);
    expect(s.part).toBeCloseTo(0.05);
    expect(s.level).toBe("ok");
  });

  it("prefere le contexte que l'agent annonce lui-meme", () => {
    const s = usageState({ context: 33_502, window: 1_000_000, input: 5 }, 200_000);
    expect(s.context).toBe(33_502);
    expect(s.window).toBe(1_000_000);
  });

  it("previent puis alerte quand la fenetre se remplit", () => {
    expect(usageState({ context: 150_000 }, 200_000).level).toBe("warn");
    expect(usageState({ context: 185_000 }, 200_000).level).toBe("full");
  });

  it("sans fenetre connue, pas de part", () => {
    const s = usageState({ context: 1_000 }, null);
    expect(s.window).toBeNull();
    expect(s.part).toBeNull();
    expect(s.level).toBe("ok");
  });
});

describe("contextEstimate", () => {
  it("part de l'ossature et ajoute le fil", () => {
    expect(contextEstimate([])).toBe(PROMPT_OVERHEAD);
    expect(contextEstimate([{ content: "a".repeat(360) }])).toBe(PROMPT_OVERHEAD + 100);
  });
});

describe("usageState avec estimation", () => {
  it("affiche l'estimation tant qu'aucun decompte exact n'est arrive", () => {
    const s = usageState(undefined, 200_000, 12_000);
    expect(s.context).toBe(12_000);
    expect(s.estimated).toBe(true);
    expect(s.part).toBeCloseTo(0.06);
  });

  it("le decompte exact prime sur l'estimation", () => {
    const s = usageState({ input: 9_000, output: 500 }, 200_000, 12_000);
    expect(s.context).toBe(9_500);
    expect(s.estimated).toBe(false);
  });
});

describe("rate", () => {
  it("jetons par seconde, arrondi", () => {
    expect(rate(300, 3000)).toBe(100);
    expect(rate(0, 3000)).toBe(0);
    expect(rate(300, 0)).toBeNull();
    expect(rate(300, 120)).toBeNull();
  });
});

describe("mise en forme", () => {
  it("les jetons en k au-dela de mille", () => {
    expect(fmtTokens(940)).toBe("940");
    expect(fmtTokens(12_400)).toBe("12,4k");
    expect(fmtTokens(1_000_000)).toBe("1,0M");
  });

  it("le cout en dollars, jamais zero trompeur", () => {
    expect(fmtCost(0)).toBeNull();
    expect(fmtCost(0.2487)).toBe("0,249 $");
    expect(fmtCost(0.00012)).toBe("< 0,001 $");
    expect(fmtCost(12.5)).toBe("12,50 $");
  });
});
