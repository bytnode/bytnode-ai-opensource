/* Figures as the user reads them: prices and quantities with their
   significant digits, amounts with two decimals and thousands separators,
   percentages with a sign. Pure. */

export { n8 } from "@/lib/tools/exchange/format";

const group = (n: number, digits: number) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 12 345.67 USD */
export const money = (n: number, currency = "USD"): string => `${group(n, 2).replace(/,/g, " ")} ${currency}`;

/** +2.35 % */
export const signedPct = (n: number, digits = 2): string => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)} %`;

/** 2.35 % */
export const pct = (n: number, digits = 2): string => `${n.toFixed(digits)} %`;
