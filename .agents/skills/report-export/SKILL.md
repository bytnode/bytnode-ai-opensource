---
name: report-export
description: Open this before writing a report with ReportExport — the structure of a report that stands on its own, how to source and date every figure, and what never goes into one
---

# A report that stands on its own

A report is read later, by someone who did not see the conversation, maybe printed. It must say what it concludes, on what, and as of when — without the thread around it.

## Before writing

- Gather the figures **with tools** (BytNode, the exchange, Backtest) in this conversation. Note, for each, the tool and the time it was read: that is the source.
- Draw the charts you want with **Chart** first: ReportExport embeds existing PNG files, it does not draw.
- A figure you cannot source does not go into the report. Say so in a "Limits" section rather than guessing.

## Structure

1. **Title** — what and when: "BTC — weekly outlook, week 39".
2. **Summary** — the conclusion in one or two sentences, first.
3. **Sections**, in Markdown — typically: context (market, levels), analysis, scenarios or strategy, risks, limits. Tables for levels and metrics.
4. **Charts** — the paths of the PNG files, in reading order.
5. **Sources** — every one used: name ("BytNode get_market_data", "Binance ExchangeTicker", a web page), link if any, **date and time read** (UTC).

The date of generation and the notice "Information, not investment advice" are added by the tool.

## Never

- A price or a figure from memory.
- A recommendation phrased as certain: give scenarios with their conditions.
- Keys, account identifiers, balances of the user's accounts unless they asked for a portfolio report.
- A source without a date.

After writing, give the user the file's path; the thread shows a link to open it.
