---
name: rapport-analyse
description: The template of a complete analysis report — synthesis, data, multi-horizon reading, macro, scenarios, confidence — to produce when an analysis is explicitly requested
---

# Analysis report

To use when you are asked for *an analysis* (not a simple market update). One page, structured, every section useful. If it must be written to a file, `rapport-<asset>-<date>.md` in the workspace.

## Template

```
# <Asset> — analysis of <date, time UTC>

## Synthesis
Three sentences: the regime, the dominant fact, the main scenario with its invalidation.
Overall confidence: low / moderate / high — and why, in one sentence.

## Data (BytNode, <time>)
Table: price, 24h / 7d / 30d change, volume vs 30d average, funding, OI (+7d change),
24h liquidations, 7d ETF flows (if available), sentiment. One row per data point, with unit.

## Trend by horizon
The table from `analyse-tendance` (structure / position / impulse / participation / verdict)
and the alignment and divergences paragraph.

## Macro context
The three-line synthesis from `contexte-macro` + the explicit link with the asset.
7-day calendar.

## Scenarios
S1 (qualitative probability): condition → development → invalidation.
S2: …
S3 (if relevant): …
What will decide between them in the next 24–72h.

## Limits
What the data does not allow one to say; what is missing; what is contradictory.
```

## Writing rules

- **Observation then interpretation**, always in that order and distinguished: "OI +8% in 3d (observation); the move is fuelled by fresh positions (interpretation)".
- **Every number**: value, unit, date, source.
- **No price target.** Levels (range, invalidation) and conditions.
- **The synthesis stands alone**: someone who reads only it has the essentials and the confidence level.
- **One page.** If the report runs over, a section is padding. Cut.
- Date the report in UTC in the title; crypto markets do not close, "today" is not enough.
