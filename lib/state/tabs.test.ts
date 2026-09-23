import { describe, expect, it } from "vitest";
import { HOME, withView, withoutViews, type TabsState } from "./tabs";

const start: TabsState = { open: [], active: HOME };

describe("tabs", () => {
  it("opening a view adds a tab and switches to it; no duplicate", () => {
    const a = withView(start, "portfolio");
    expect(a).toEqual({ open: [{ view: "portfolio" }], active: "portfolio" });
    const b = withView(withView(a, "watchlist"), "portfolio", { account: "Binance-main" });
    expect(b).toEqual({ open: [{ view: "portfolio", params: { account: "Binance-main" } }, { view: "watchlist" }], active: "portfolio" });
  });

  it("closing the active tab falls back on its left neighbour, then home", () => {
    const three: TabsState = { open: [{ view: "a" }, { view: "b" }, { view: "c" }], active: "b" };
    expect(withoutViews(three, ["b"])).toEqual({ open: [{ view: "a" }, { view: "c" }], active: "a" });
    expect(withoutViews({ ...three, active: "a" }, ["a"])).toEqual({ open: [{ view: "b" }, { view: "c" }], active: "b" });
    expect(withoutViews({ open: [{ view: "a" }], active: "a" }, ["a"])).toEqual({ open: [], active: HOME });
  });

  it("closing another tab keeps the active one", () => {
    expect(withoutViews({ open: [{ view: "a" }, { view: "b" }], active: "a" }, ["b"])).toEqual({ open: [{ view: "a" }], active: "a" });
  });
});
