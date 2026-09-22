import { describe, expect, test } from "vitest";
import { describeExchangeError, isTransientExchangeError, withRetry } from "./errors";

const err = (name: string, message: string) => Object.assign(new Error(message), { name });

describe("describeExchangeError", () => {
  test("plain sentence, then the exchange's text", () => {
    expect(describeExchangeError(err("InsufficientFunds", 'binance {"code":-2019,"msg":"Margin is insufficient."}'))).toBe(
      'Insufficient funds. Exchange: binance {"code":-2019,"msg":"Margin is insufficient."}',
    );
    expect(describeExchangeError(err("InvalidOrder", "x"))).toBe("Order refused by the exchange. Exchange: x");
    expect(describeExchangeError(err("AuthenticationError", "x"))).toBe("API key refused: check the account in Authentication (Test button). Exchange: x");
    expect(describeExchangeError(err("BadSymbol", "x"))).toBe("Unknown market on this exchange. Exchange: x");
    expect(describeExchangeError(err("RateLimitExceeded", "x"))).toBe("Too many requests: the exchange asks to slow down. Exchange: x");
    expect(describeExchangeError(err("NetworkError", "x"))).toBe("The exchange is unreachable. Exchange: x");
  });
  test("a clock skew is named, with the measured gap", () => {
    const bybit = err(
      "InvalidNonce",
      'bybit {"retCode":10002,"retMsg":"invalid request, please check your server timestamp or recv_window param: req_timestamp[1789501205653],server_timestamp[1789501211672],recv_window[5000]","result":{}}',
    );
    expect(describeExchangeError(bybit)).toMatch(/^This computer's clock is off by about 6 s from the exchange's: synchronize the system time\. Exchange: bybit/);
    const binance = err("BadRequest", 'binance {"code":-1021,"msg":"Timestamp for this request is outside of the recvWindow."}');
    expect(describeExchangeError(binance)).toMatch(/^This computer's clock is off from the exchange's: synchronize the system time\. Exchange: binance/);
  });
  test("an unknown error keeps its text", () => {
    expect(describeExchangeError(new Error("boom"))).toBe("The exchange answered with an error. Exchange: boom");
    expect(describeExchangeError("text")).toBe("The exchange answered with an error. Exchange: text");
  });
});

describe("withRetry", () => {
  test("retries once on a transient error", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      n++;
      if (n === 1) throw err("RequestTimeout", "t");
      return "ok";
    }, 0);
    expect(r).toBe("ok");
    expect(n).toBe(2);
  });
  test("does not retry a hard error, nor more than once", async () => {
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
