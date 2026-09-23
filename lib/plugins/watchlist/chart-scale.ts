/* ---------------------------------------------------------------------------
   The price chart's scales: round price levels for the right axis, as
   many decimals as the price needs, and the times worth a label on the
   bottom axis — the day at midnight, the hour otherwise.
   Pure, tested.
--------------------------------------------------------------------------- */

/** Round levels between lo and hi, about `count` of them (1, 2, 2.5, 5 ×
    10ⁿ steps). */
export function niceTicks(lo: number, hi: number, count: number): { step: number; ticks: number[] } {
  if (!(hi > lo) || count < 1) return { step: 0, ticks: [] };
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return { step, ticks };
}

/** Decimals for a price: enough to show a step of the axis, and the
    price's own significant digits — 2 for 2,694.60, 5 for 0.26431. */
export function decimalsFor(price: number, step = 0): number {
  const a = Math.abs(price);
  const own = a >= 1000 ? 1 : a >= 1 ? 2 : a > 0 ? Math.min(8, 3 - Math.floor(Math.log10(a))) : 2;
  const fromStep = step > 0 ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 0;
  return Math.min(8, Math.max(own, fromStep));
}

/** The label steps for the time axis, in ms. */
const TIME_STEPS = [5, 15, 30, 60, 120, 240, 360, 720, 1440, 2880, 10080, 43200].map((m) => m * 60_000);

/** The step between two time labels: the smallest that keeps them `minPx`
    apart when one bar of `barMs` is `barPx` wide. */
export function timeStep(barMs: number, barPx: number, minPx: number): number {
  const msPerPx = barMs / Math.max(barPx, 1e-6);
  return TIME_STEPS.find((s) => s / msPerPx >= minPx) ?? TIME_STEPS[TIME_STEPS.length - 1];
}

/** The times in [from, to] on the step, in the viewer's local time (a
    day's step falls on local midnight). */
export function timeTicks(from: number, to: number, step: number): number[] {
  if (!(to > from) || step <= 0) return [];
  const offset = new Date(from).getTimezoneOffset() * 60_000;
  const out: number[] = [];
  for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) out.push(t);
  return out;
}

/** A time label: the date at local midnight, the hour otherwise. */
export function timeLabel(t: number, locale = "en-GB"): string {
  const d = new Date(t);
  if (d.getHours() === 0 && d.getMinutes() === 0) return d.toLocaleDateString(locale, d.getDate() === 1 ? { month: "short" } : { day: "numeric", month: "short" });
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
