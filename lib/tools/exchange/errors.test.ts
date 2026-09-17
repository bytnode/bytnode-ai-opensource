import { describe, expect, test } from "vitest";
import { describeExchangeError, isTransientExchangeError, withRetry } from "./errors";

const err = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("describeExchangeError", () => {
  test("phrase francaise, puis le texte de l'exchange", () => {
    expect(describeExchangeError(err("InsufficientFunds", 'binance {"code":-2019,"msg":"Margin is insufficient."}'))).toBe(
      'Fonds insuffisants. Exchange : binance {"code":-2019,"msg":"Margin is insufficient."}',
    );
    expect(describeExchangeError(err("InvalidOrder", "x"))).toBe("Ordre refusé par l'exchange. Exchange : x");
    expect(describeExchangeError(err("AuthenticationError", "x"))).toBe("Clé API refusée : vérifiez le compte dans Authentification (bouton Tester). Exchange : x");
    expect(describeExchangeError(err("BadSymbol", "x"))).toBe("Marché inconnu sur cet exchange. Exchange : x");
    expect(describeExchangeError(err("RateLimitExceeded", "x"))).toBe("Trop de requêtes : l'exchange demande de ralentir. Exchange : x");
    expect(describeExchangeError(err("NetworkError", "x"))).toBe("L'exchange est injoignable. Exchange : x");
  });
  test("un decalage d'horloge est nomme, avec l'ecart mesure", () => {
    const bybit = err(
      "InvalidNonce",
      'bybit {"retCode":10002,"retMsg":"invalid request, please check your server timestamp or recv_window param: req_timestamp[1789501205653],server_timestamp[1789501211672],recv_window[5000]","result":{}}',
    );
    expect(describeExchangeError(bybit)).toMatch(/^L'horloge de cet ordinateur est décalée d'environ 6 s par rapport à l'exchange : synchronisez l'heure du système\. Exchange : bybit/);
    const binance = err("BadRequest", 'binance {"code":-1021,"msg":"Timestamp for this request is outside of the recvWindow."}');
    expect(describeExchangeError(binance)).toMatch(/^L'horloge de cet ordinateur est décalée par rapport à l'exchange : synchronisez l'heure du système\. Exchange : binance/);
  });
  test("une erreur inconnue garde son texte", () => {
    expect(describeExchangeError(new Error("boom"))).toBe("L'exchange a répondu par une erreur. Exchange : boom");
    expect(describeExchangeError("texte")).toBe("L'exchange a répondu par une erreur. Exchange : texte");
  });
});

describe("withRetry", () => {
  test("reessaie une fois sur une erreur passagere", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      n++;
      if (n === 1) throw err("RequestTimeout", "t");
      return "ok";
    }, 0);
    expect(r).toBe("ok");
    expect(n).toBe(2);
  });
  test("ne reessaie pas une erreur franche, ni plus d'une fois", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw err("InvalidOrder", "x");
      }, 0),
    ).rejects.toThrow("x");
    expect(n).toBe(1);
    n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw err("NetworkError", "x");
      }, 0),
    ).rejects.toThrow("x");
    expect(n).toBe(2);
  });
});

test("isTransientExchangeError", () => {
  expect(isTransientExchangeError(err("DDoSProtection", ""))).toBe(true);
  expect(isTransientExchangeError(err("ExchangeNotAvailable", ""))).toBe(true);
  expect(isTransientExchangeError(err("InsufficientFunds", ""))).toBe(false);
});
