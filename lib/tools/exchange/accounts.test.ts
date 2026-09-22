import { describe, expect, test } from "vitest";
import { allowedAccounts, describeAccounts, encodeAccountsHeader, parseAccounts, parseAccountsHeader, pickAccount } from "./accounts";
import { pemSecret } from "./accounts";
import type { ExchangeAccount } from "@/lib/domain/types";

const main: ExchangeAccount = { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false };
const test1: ExchangeAccount = { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "", testnet: true };

describe("parseAccounts", () => {
  test("keeps complete accounts, drops the rest", () => {
    expect(parseAccounts([main, { id: "x", label: "no exchange" }, null, "x"])).toEqual([main]);
    expect(parseAccounts("not a list")).toEqual([]);
  });
  test("from a header: unreadable or empty JSON → no account", () => {
    expect(parseAccountsHeader(JSON.stringify([main, test1]))).toEqual([main, test1]);
    expect(parseAccountsHeader("{oops")).toEqual([]);
    expect(parseAccountsHeader(null)).toEqual([]);
    expect(parseAccountsHeader("")).toEqual([]);
  });
  test("round trip through the encoded header, even with a non-Latin-1 label", () => {
    const euro = { ...main, label: "Binance €/🚀" };
    const header = encodeAccountsHeader([euro, test1]);
    expect(/^[\x00-\x7f]*$/.test(header)).toBe(true);
    expect(parseAccountsHeader(header)).toEqual([euro, test1]);
  });
});

describe("pickAccount", () => {
  test("a single account: implicit", () => {
    expect(pickAccount([main], undefined)).toEqual({ account: main });
  });
  test("several accounts without a name: error listing the labels", () => {
    const r = pickAccount([main, test1], undefined);
    expect("error" in r && r.error).toBe("Several accounts: specify `account` among Binance-main, Bybit-test.");
  });
  test("by label (case-insensitive) or by id", () => {
    expect(pickAccount([main, test1], "bybit-test")).toEqual({ account: test1 });
    expect(pickAccount([main, test1], "x1")).toEqual({ account: main });
  });
  test("unknown: error", () => {
    const r = pickAccount([main, test1], "Kraken");
    expect("error" in r && r.error).toBe('Unknown account: "Kraken". Available accounts: Binance-main, Bybit-test.');
  });
  test("no account: error", () => {
    expect(pickAccount([], undefined)).toEqual({ error: "No exchange account is attached to this agent." });
  });
});

describe("allowedAccounts", () => {
  test("returns only the accounts on the agent's list, in settings order", () => {
    expect(allowedAccounts([main, test1], ["x2"])).toEqual([test1]);
    expect(allowedAccounts([main, test1], ["x9", "x1"])).toEqual([main]);
    expect(allowedAccounts([main, test1], undefined)).toEqual([]);
  });
});

describe("describeAccounts", () => {
  test("one line for the prompt", () => {
    expect(describeAccounts([main, test1])).toBe("Binance-main (binance, LIVE), Bybit-test (bybit, testnet)");
  });
});

describe("pemSecret", () => {
  const body = "MHcCAQEEIExampleExampleExampleExampleExampleExampleExampleExampleoAoGCCqGSM49AwEHoUQDQgAEexampleexampleexampleexampleexampleexampleexampleexampleexampleexampleexampleexamplex";
  test("a key that is not a PEM is returned as is", () => {
    expect(pemSecret("abc123")).toBe("abc123");
  });
  test("the literal \\n of a CDP JSON become line breaks again", () => {
    const pasted = `-----BEGIN EC PRIVATE KEY-----\\n${body}\\n-----END EC PRIVATE KEY-----\\n`;
    expect(pemSecret(pasted)).toBe(`-----BEGIN EC PRIVATE KEY-----\n${body.slice(0, 64)}\n${body.slice(64, 128)}\n${body.slice(128)}\n-----END EC PRIVATE KEY-----\n`);
  });
  test("a PEM flattened on one line is rebuilt (body wrapped at 64)", () => {
    const flat = `-----BEGIN EC PRIVATE KEY----- ${body} -----END EC PRIVATE KEY-----`;
    const out = pemSecret(flat);
    const lines = out.split("\n");
    expect(lines[0]).toBe("-----BEGIN EC PRIVATE KEY-----");
    expect(lines.at(-2)).toBe("-----END EC PRIVATE KEY-----");
    expect(lines.slice(1, -2).every((l) => l.length <= 64)).toBe(true);
    expect(lines.slice(1, -2).join("")).toBe(body);
  });
  test("an already well-formed PEM does not change", () => {
    const good = `-----BEGIN EC PRIVATE KEY-----\n${body.slice(0, 64)}\n${body.slice(64, 128)}\n${body.slice(128)}\n-----END EC PRIVATE KEY-----\n`;
    expect(pemSecret(good)).toBe(good);
  });
});
