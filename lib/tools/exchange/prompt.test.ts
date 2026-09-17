import { describe, expect, test } from "vitest";
import { exchangePromptSection } from "./prompt";
import type { ExchangeAccount } from "@/lib/domain/types";

const bybit: ExchangeAccount = { id: "x1", exchange: "bybit", label: "Bybit-main", apiKey: "a", secret: "b", password: "", testnet: false };

describe("exchangePromptSection", () => {
  test("sans compte configure : rien", () => {
    expect(exchangePromptSection([], "mcp")).toEqual([]);
    expect(exchangePromptSection(undefined, "natif", 0)).toEqual([]);
  });
  test("des comptes existent mais aucun n'est rattache : l'agent doit le dire, pas contourner", () => {
    const lines = exchangePromptSection([], "mcp", 2).join("\n");
    expect(lines).toContain("2 comptes exchange dans BytNode-AI, mais aucun n'est rattaché");
    expect(lines).toContain("Réglages → Agents → Modifier");
    expect(lines).toContain("Ne cherche pas de clé");
  });
  test("un compte rattache : les outils, les limites de l'exchange, la discipline", () => {
    const lines = exchangePromptSection([bybit], "mcp").join("\n");
    expect(lines).toContain("Bybit-main (bybit, RÉEL)");
    expect(lines).toContain("ExchangeBalance");
    expect(lines).toContain("Limites :");
    expect(lines).toContain("Bybit : pas de Transfer");
    expect(lines).toContain("portefeuille Funding");
  });
  test("un sous-agent : lecture seule, aucun outil d'action nomme", () => {
    const lines = exchangePromptSection([bybit], "natif", 0, true).join("\n");
    expect(lines).toContain("lecture seule");
    expect(lines).toContain("ExchangeBalance");
    expect(lines).not.toContain("PlaceOrder");
    expect(lines).not.toContain("Transfer");
    expect(lines).toContain("nomme toujours `account`");
    expect(exchangePromptSection([], "mcp", 2, true)).not.toEqual([]);
  });
});
