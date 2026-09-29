---
name: calcul-verifie
description: Open this as soon as a number must appear in the answer — a change, an average, an annualisation, basis points, a position size: how to compute it by executing it rather than in your head, and how to check it
---

# No numbers from your head

You are strong at reasoning and weak at arithmetic: a percentage change, twelve months of compounding, an annualisation, two operations chained together — that is where you go wrong, and the wrong number goes unnoticed because the reasoning around it is sound.

**Rule: every number that appears in your answer comes either from a field read as-is in a tool response, or from a calculation you executed.** Never from mental arithmetic.

## How to execute

A short calculation: one command.

```bash
python -c "
a, b = 111_240.0, 103_820.0
print(f'variation {100*(a/b-1):.2f} %')
"
```

A series, a table, several assets: the data in a file (`SaveMarketData`), then pandas. A backtest: the `Backtest` tool, never a home-made engine.

If you cannot execute (tool refused, no Python), you do not give the number: you say what would need to be computed and offer to do it.

## The formulas that go wrong most often

| What you want | Formula | Trap |
|---|---|---|
| Change | `(end / start - 1)` | −50% then +50% does not get back to the starting point |
| Return to the initial point after −x | `1/(1-x) - 1` | −20% requires +25%, not +20% |
| Compounding n changes | `prod(1 + r_i) - 1` | never the sum |
| Annualising a return over p periods/year | `(1 + r)**p - 1` | `r * p` is wrong as soon as r is large |
| Annualising a volatility | `sigma * sqrt(p)` | `sigma * p` is wrong |
| Basis points | `1 bp = 0.01% = 0.0001` | 25 bp ≠ 0.25 bp |
| Funding 8h → annualised | `f * 3 * 365` | a "0.01%" funding is ~10.95%/year |
| Average of percentages | **geometric** mean for returns | the arithmetic mean overestimates |
| Position size at risk r | `capital * r / distance_to_stop` | the distance is in price, not in % of capital |

## The check before writing

Three questions, every time:

1. **Order of magnitude**: is the result plausible? An asset does not do +4,000% in a day; a Sharpe of 12 does not exist; a drawdown does not exceed −100%.
2. **Unit and sign**: percentage or fraction? per day or per year? long or short? Write the unit next to the number in the code itself.
3. **Two paths**: for a number that carries a conclusion, recompute it another way (sum of the parts vs total, or two windows that must coincide).

## The precision displayed

Do not display more precision than the data carries. A price: the market's precision. A percentage: two decimals. A Sharpe: two decimals. `0.0347281%` is false precision — write `0.03%`.

Round **at the end**, never mid-calculation.

## Related

- `horodatage`: where the numbers come from and at what time.
- `citer-ou-se-taire`: how to present them.
