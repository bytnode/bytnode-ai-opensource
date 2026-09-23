import { describe, expect, it } from "vitest";
import type { ExchangeAccount } from "@/lib/domain/types";
import { HEADER, parsePluginIds, readTransport, transportHeaders } from "./transport";

const euro: ExchangeAccount = { id: "x1", exchange: "binance", label: "Binance €", apiKey: "k", secret: "s", password: "", testnet: false };
const headers = (h: Record<string, string>) => new Headers(h);

describe("transport", () => {
  it("round-trips everything a request carries", () => {
    const sent = transportHeaders({ openrouterKey: "sk", bytnodeKey: "bn", exchangeAccounts: [euro], plugins: ["watchlist", "position-calc"] });
    expect(readTransport(headers(sent))).toEqual({ openrouterKey: "sk", bytnodeKey: "bn", exchangeAccounts: [euro], plugins: ["watchlist", "position-calc"] });
  });

  it("sends nothing for what is empty", () => {
    expect(transportHeaders({ openrouterKey: " ", bytnodeKey: "", exchangeAccounts: [], plugins: null })).toEqual({});
    expect(transportHeaders({ plugins: [] })).toEqual({ [HEADER.plugins]: encodeURIComponent("[]") });
  });

  it("an absent plugin header means every active plugin; an empty one, none", () => {
    expect(readTransport(headers({})).plugins).toBeNull();
    expect(readTransport(headers({ [HEADER.plugins]: "%5B%5D" })).plugins).toEqual([]);
    expect(readTransport(headers({ [HEADER.plugins]: "not json" })).plugins).toEqual([]);
  });

  it("reads plugin ids without trust", () => {
    expect(parsePluginIds(["watchlist", "watchlist", 3, "../etc", "Scheduler", "dca"])).toEqual(["watchlist", "dca"]);
    expect(parsePluginIds("watchlist")).toEqual([]);
  });

  it("also reads raw JSON, as the MCP server's environment carries it", () => {
    expect(readTransport(headers({ [HEADER.plugins]: '["alerts"]' })).plugins).toEqual(["alerts"]);
  });
});
