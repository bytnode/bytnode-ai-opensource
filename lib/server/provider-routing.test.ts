import { describe, expect, it } from "vitest";
import { providerRouting } from "./provider-routing";

describe("providerRouting", () => {
  it("sorts by latency and ignores slow providers by default", () => {
    const p = providerRouting({});
    expect(p).toEqual({ sort: "latency", ignore: ["parasail"], allow_fallbacks: true });
  });

  it("accepts another sort", () => {
    expect(providerRouting({ sort: "throughput" }).sort).toBe("throughput");
    expect(providerRouting({ sort: "price" }).sort).toBe("price");
  });

  it("refuses an unknown sort and falls back to latency", () => {
    expect(providerRouting({ sort: "whatever" }).sort).toBe("latency");
  });

  it("replaces the exclusion list, separators and casing left free", () => {
    expect(providerRouting({ ignore: "Parasail, DeepInfra ; novita" }).ignore).toEqual(["parasail", "deepinfra", "novita"]);
  });

  it("an empty list ignores no one", () => {
    const p = providerRouting({ ignore: "" });
    expect(p.ignore).toBeUndefined();
  });

  it("an explicit order takes priority and cuts off the sort", () => {
    const p = providerRouting({ order: "Together, Fireworks" });
    expect(p).toEqual({ order: ["Together", "Fireworks"], ignore: ["parasail"], allow_fallbacks: true });
    expect(p.sort).toBeUndefined();
  });

  it("fallbacks can be switched off", () => {
    expect(providerRouting({ fallbacks: "0" }).allow_fallbacks).toBe(false);
    expect(providerRouting({ fallbacks: "false" }).allow_fallbacks).toBe(false);
    expect(providerRouting({ fallbacks: "1" }).allow_fallbacks).toBe(true);
  });
});
