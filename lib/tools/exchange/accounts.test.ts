import { describe, expect, test } from "vitest";
import { allowedAccounts, describeAccounts, encodeAccountsHeader, parseAccounts, parseAccountsHeader, pickAccount } from "./accounts";
import { pemSecret } from "./accounts";
import type { ExchangeAccount } from "@/lib/domain/types";

const main: ExchangeAccount = { id: "x1", exchange: "binance", label: "Binance-main", apiKey: "a", secret: "b", password: "", testnet: false };
const test1: ExchangeAccount = { id: "x2", exchange: "bybit", label: "Bybit-test", apiKey: "c", secret: "d", password: "", testnet: true };

describe("parseAccounts", () => {
  test("garde les comptes complets, ecarte le reste", () => {
    expect(parseAccounts([main, { id: "x", label: "sans exchange" }, null, "x"])).toEqual([main]);
    expect(parseAccounts("pas une liste")).toEqual([]);
  });
  test("depuis un en-tete : JSON illisible ou vide → aucun compte", () => {
    expect(parseAccountsHeader(JSON.stringify([main, test1]))).toEqual([main, test1]);
    expect(parseAccountsHeader("{oops")).toEqual([]);
    expect(parseAccountsHeader(null)).toEqual([]);
    expect(parseAccountsHeader("")).toEqual([]);
  });
  test("aller-retour par l'en-tete encode, meme avec un label hors Latin-1", () => {
    const euro = { ...main, label: "Binance €/🚀" };
    const header = encodeAccountsHeader([euro, test1]);
    expect(/^[\x00-\x7f]*$/.test(header)).toBe(true);
    expect(parseAccountsHeader(header)).toEqual([euro, test1]);
  });
});

describe("pickAccount", () => {
  test("un seul compte : implicite", () => {
    expect(pickAccount([main], undefined)).toEqual({ account: main });
  });
  test("plusieurs comptes sans nom : erreur qui liste les labels", () => {
    const r = pickAccount([main, test1], undefined);
    expect("error" in r && r.error).toBe("Plusieurs comptes : précise `account` parmi Binance-main, Bybit-test.");
  });
  test("par label (insensible a la casse) ou par id", () => {
    expect(pickAccount([main, test1], "bybit-test")).toEqual({ account: test1 });
    expect(pickAccount([main, test1], "x1")).toEqual({ account: main });
  });
  test("inconnu : erreur", () => {
    const r = pickAccount([main, test1], "Kraken");
    expect("error" in r && r.error).toBe("Compte inconnu : « Kraken ». Comptes disponibles : Binance-main, Bybit-test.");
  });
  test("aucun compte : erreur", () => {
    expect(pickAccount([], undefined)).toEqual({ error: "Aucun compte exchange n'est rattaché à cet agent." });
  });
});

describe("allowedAccounts", () => {
  test("ne rend que les comptes de la liste de l'agent, dans l'ordre des reglages", () => {
    expect(allowedAccounts([main, test1], ["x2"])).toEqual([test1]);
    expect(allowedAccounts([main, test1], ["x9", "x1"])).toEqual([main]);
    expect(allowedAccounts([main, test1], undefined)).toEqual([]);
  });
});

describe("describeAccounts", () => {
  test("une ligne pour le prompt", () => {
    expect(describeAccounts([main, test1])).toBe("Binance-main (binance, RÉEL), Bybit-test (bybit, testnet)");
  });
});

describe("pemSecret", () => {
  const body = "MHcCAQEEIExampleExampleExampleExampleExampleExampleExampleExampleoAoGCCqGSM49AwEHoUQDQgAEexampleexampleexampleexampleexampleexampleexampleexampleexampleexampleexampleexamplex";
  test("une cle qui n'est pas un PEM est rendue telle quelle", () => {
    expect(pemSecret("abc123")).toBe("abc123");
  });
  test("les \\n litteraux d'un JSON CDP redeviennent des sauts de ligne", () => {
    const pasted = `-----BEGIN EC PRIVATE KEY-----\\n${body}\\n-----END EC PRIVATE KEY-----\\n`;
    expect(pemSecret(pasted)).toBe(`-----BEGIN EC PRIVATE KEY-----\n${body.slice(0, 64)}\n${body.slice(64, 128)}\n${body.slice(128)}\n-----END EC PRIVATE KEY-----\n`);
  });
  test("un PEM aplati sur une ligne est recompose (corps replie a 64)", () => {
    const flat = `-----BEGIN EC PRIVATE KEY----- ${body} -----END EC PRIVATE KEY-----`;
    const out = pemSecret(flat);
    const lines = out.split("\n");
    expect(lines[0]).toBe("-----BEGIN EC PRIVATE KEY-----");
    expect(lines.at(-2)).toBe("-----END EC PRIVATE KEY-----");
    expect(lines.slice(1, -2).every((l) => l.length <= 64)).toBe(true);
    expect(lines.slice(1, -2).join("")).toBe(body);
  });
  test("un PEM deja bien forme ne change pas", () => {
    const good = `-----BEGIN EC PRIVATE KEY-----\n${body.slice(0, 64)}\n${body.slice(64, 128)}\n${body.slice(128)}\n-----END EC PRIVATE KEY-----\n`;
    expect(pemSecret(good)).toBe(good);
  });
});
