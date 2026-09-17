import { describe, expect, it } from "vitest";
import { buildChartSvg, niceTicks, type ChartSpec } from "./svg";

const candles = Array.from({ length: 30 }, (_, i) => ({
  time: Date.UTC(2024, 0, 1 + i),
  open: 100 + i,
  high: 102 + i,
  low: 99 + i,
  close: 101 + i,
  volume: 10 + i,
}));

describe("niceTicks", () => {
  it("rend des graduations rondes qui couvrent l'intervalle", () => {
    const t = niceTicks(99, 131, 5);
    expect(t[0]).toBeLessThanOrEqual(99);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(131);
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t.length).toBeLessThanOrEqual(9);
  });
});

describe("buildChartSvg", () => {
  const base: ChartSpec = { title: "BTC 1d", type: "candles", series: candles, overlays: [], markers: [], hlines: [], width: 800, height: 400 };

  it("produit un SVG avec une bougie par ligne", () => {
    const svg = buildChartSvg(base);
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/class="candle"/g) ?? []).length).toBe(30);
    expect(svg).toContain("BTC 1d");
  });

  it("dessine les overlays, les marqueurs et les lignes horizontales", () => {
    const svg = buildChartSvg({
      ...base,
      overlays: [{ name: "sma", values: candles.map((c) => c.close - 1), color: "#f00" }],
      markers: [{ time: candles[5].time, price: 106, label: "achat", kind: "buy" }],
      hlines: [{ price: 110, label: "résistance" }],
    });
    expect(svg).toContain('class="overlay"');
    expect(svg).toContain("achat");
    expect(svg).toContain("résistance");
  });

  it("dessine une ligne quand il n'y a pas d'OHLC", () => {
    const svg = buildChartSvg({ ...base, type: "line", series: candles.map((c) => ({ time: c.time, close: c.close })) });
    expect(svg).toContain('class="price-line"');
    expect(svg).not.toContain('class="candle"');
  });

  it("echappe le texte", () => {
    const svg = buildChartSvg({ ...base, title: "<b>x</b> & y" });
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });
});
