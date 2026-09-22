/* ---------------------------------------------------------------------------
   The professions: what specialises an agent.

   Four trades, each with its system prompt and its skills, read from
   `professions/<id>/` at the project root (see `load.ts`, server only).
   This file only carries the catalog — shared with the browser, which uses
   it for the choice when an agent is created.
--------------------------------------------------------------------------- */

export type ProfessionId = "standard" | "analyste" | "strategique" | "quantitatif";

export type ProfessionInfo = { id: ProfessionId; label: string; short: string; description: string };

export const PROFESSIONS: ProfessionInfo[] = [
  {
    id: "standard",
    label: "Standard",
    short: "Generalist",
    description: "Solid across finance and crypto markets as a whole, with no speciality. The right first point of contact.",
  },
  {
    id: "analyste",
    label: "Analyst",
    short: "Data & trends",
    description: "Reads market data and the macro context, derives trends and scenarios from them, with a confidence level.",
  },
  {
    id: "strategique",
    label: "Strategist",
    short: "Strategies",
    description: "Designs complete strategies — objective, entry and exit rules, risk, test plan — crypto-focused, open to other markets.",
  },
  {
    id: "quantitatif",
    label: "Quantitative",
    short: "Maths & code",
    description: "Mathematics, statistics and Python: models, backtests and implements algorithms with rigour.",
  },
];

export const DEFAULT_PROFESSION: ProfessionId = "standard";

export const isProfessionId = (v: unknown): v is ProfessionId => PROFESSIONS.some((p) => p.id === v);

export const professionInfo = (id: ProfessionId): ProfessionInfo => PROFESSIONS.find((p) => p.id === id) ?? PROFESSIONS[0];
