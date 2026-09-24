---
name: macro-conventions
description: Open this as soon as a macro indicator enters the analysis — CPI, employment, rates, liquidity: which variant we read, in what unit, and what usual effect on crypto (with its counter-examples)
---

# Reading macro without distorting it

Your macro errors are not reasoning errors: they are confusions of variant and unit. Core or headline, monthly or annual, nominal or real, level or change — picking the wrong column reverses the conclusion.

## The indicators and their traps

| Indicator | What we read | Classic trap |
|---|---|---|
| **CPI / inflation** | the gap to expectations, on **core** (ex energy and food) and on headline, m/m **and** y/y | a falling y/y with an accelerating m/m: disinflation is over. The y/y alone lags by a year |
| **Employment (NFP, unemployment)** | payrolls + revisions of previous months + wages | revisions often change the meaning of the release; unemployment and payrolls can move in the same direction (participation) |
| **Policy rates** | what is **already priced** by the futures market, not the level | a rate cut expected for three months is already in prices: the surprise counts, not the decision |
| **Real yields** | nominal − expected inflation | a rising nominal with inflation rising faster is an easing, not a tightening |
| **DXY / dollar** | the change, not the level | "DXY at 104" says nothing; "+2% in two weeks" says something |
| **Global liquidity** | central bank balance sheets, reverse repo, reserves | mixing zones; the rhythms are monthly, not daily |
| **ETF flows** | net, cumulative, and relative to market volume | a gross flow without a denominator cannot be interpreted |

## The usual effect on crypto — and why it breaks

The usual chain: **upside inflation surprise → higher expected real rates → less risk appetite → crypto under pressure.** And the reverse.

Three reasons why this chain fails regularly, to check before invoking it:

1. **The correlation is not stable.** Crypto follows tech equities for periods, then detaches. Quantify the correlation over the recent window before reasoning "risk asset".
2. **Crypto-specific flows often dominate.** ETF, halving, liquidations, protocol event: the endogenous crushes the macro over short horizons.
3. **The regime rules.** In a phase of extreme aversion, everything falls together and the macro nuances disappear.

So: the macro reading enters the analysis as **context and calendar**, not as a short-term forecasting mechanism.

## The calendar

The user's calendar (when the Calendar plugin is on) holds only what agents wrote in it: `EventSearch` reads it, it does not fetch anything. What you can do, honestly:

- **Dates known by construction** (central bank meetings, monthly releases) are looked up on the web, dated and attributed (`WebSearch`, `WebFetch`) — and, when the user wants them kept, written to the calendar with `CalendarEdit`, each with the URL of the page that announces it.
- What is **in the BytNode data** (`get_market_indicators`, the macro families that `get_system_info` lists) takes precedence, because it is measured.
- What you cannot verify, you do not assert: "I do not know the exact date of the next CPI release, I can look it up".

And never a date from memory: a central bank meeting "on the 18th" pulled from your memory is an invention (`horodatage`).

## The form in the report

Two to four lines, never an economics lecture:

> **Macro**: core inflation at 0.3% m/m versus 0.2% expected (as-of …, source …); the futures market cuts the probability of a rate cut to 35% (from 55% a month ago). Context unfavourable to risk, but the 30d BTC/Nasdaq correlation is 0.31: the direct effect is weak right now.

## Related

- `contexte-macro`: the place of macro in the analysis.
- `piege-de-la-narration`: macro is the first supplier of false causes.
- `citer-ou-se-taire`: a date or a consensus is cited, not guessed.
