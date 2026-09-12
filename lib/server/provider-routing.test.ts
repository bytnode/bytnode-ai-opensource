import { describe, expect, it } from "vitest";
import { providerRouting } from "./provider-routing";

describe("providerRouting", () => {
  it("trie par latence et ignore les fournisseurs lents par defaut", () => {
    const p = providerRouting({});
    expect(p).toEqual({ sort: "latency", ignore: ["parasail"], allow_fallbacks: true });
  });

  it("accepte un autre tri", () => {
    expect(providerRouting({ sort: "throughput" }).sort).toBe("throughput");
    expect(providerRouting({ sort: "price" }).sort).toBe("price");
  });

  it("refuse un tri inconnu et retombe sur la latence", () => {
    expect(providerRouting({ sort: "n'importe quoi" }).sort).toBe("latency");
  });

  it("remplace la liste d'exclusions, separateurs et casse libres", () => {
    expect(providerRouting({ ignore: "Parasail, DeepInfra ; novita" }).ignore).toEqual(["parasail", "deepinfra", "novita"]);
  });

  it("une liste vide n'ignore personne", () => {
    const p = providerRouting({ ignore: "" });
    expect(p.ignore).toBeUndefined();
  });

  it("un ordre explicite prime et coupe le tri", () => {
    const p = providerRouting({ order: "Together, Fireworks" });
    expect(p).toEqual({ order: ["Together", "Fireworks"], ignore: ["parasail"], allow_fallbacks: true });
    expect(p.sort).toBeUndefined();
  });

  it("les replis se desactivent", () => {
    expect(providerRouting({ fallbacks: "0" }).allow_fallbacks).toBe(false);
    expect(providerRouting({ fallbacks: "false" }).allow_fallbacks).toBe(false);
    expect(providerRouting({ fallbacks: "1" }).allow_fallbacks).toBe(true);
  });
});
