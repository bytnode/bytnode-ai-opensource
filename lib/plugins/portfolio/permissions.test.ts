import { describe, expect, it } from "vitest";
import { apiKeysUrl, bybitMissing, bybitShown, missingFromCoverage } from "./permissions";

describe("bybitMissing", () => {
  it("names the boxes a Bybit key lacks", () => {
    const granted = { Wallet: ["AccountTransfer"], Earn: [], Exchange: ["ExchangeHistory"], Spot: ["SpotTrade"] };
    expect(bybitMissing(granted).map((m) => m.key)).toEqual(["earn"]);
    expect(bybitMissing({ Wallet: [], Earn: ["Earn"], Exchange: [] }).map((m) => m.key)).toEqual(["wallet", "exchange"]);
    expect(bybitMissing({ Wallet: ["AccountTransfer"], Earn: ["Earn"], Exchange: ["ExchangeHistory"] })).toEqual([]);
  });

  it("says nothing when Bybit did not answer", () => {
    expect(bybitMissing(null)).toEqual([]);
  });

  it("says what the history is then made of", () => {
    expect(bybitShown([])).toMatch(/whole account/);
    expect(bybitShown(bybitMissing({ Wallet: ["AccountTransfer"], Earn: [] }))).toMatch(/Unified trading account, and the Funding wallet/);
    expect(bybitShown(bybitMissing({}))).toMatch(/Unified trading account only/);
  });
});

describe("missingFromCoverage", () => {
  it("keeps the kinds refused for want of a permission", () => {
    const m = missingFromCoverage({
      deposits: { status: "error", note: "The API key does not have this permission on the exchange." },
      trades: { status: "error", note: "The exchange is unreachable." },
      ledger: { status: "ok" },
    });
    expect(m).toEqual([{ key: "deposits", label: "Deposits", what: "the deposits" }]);
  });
});

describe("apiKeysUrl", () => {
  it("links the exchange's key page, the test network's for a testnet account", () => {
    expect(apiKeysUrl("bybit", false)).toBe("https://www.bybit.com/app/user/api-management");
    expect(apiKeysUrl("bybit", true)).toBe("https://testnet.bybit.com/app/user/api-management");
    expect(apiKeysUrl("okx", true)).toBe("https://www.okx.com/account/my-api");
    expect(apiKeysUrl("nope", false)).toBeUndefined();
  });
});
