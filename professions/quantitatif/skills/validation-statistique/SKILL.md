---
name: validation-statistique
description: Verify that a quantitative result holds — out-of-sample, walk-forward, sensitivity, naive benchmarks, multiple testing, Sharpe deflation — and say so without complacency
---

# Statistical validation

A backtest result is a hypothesis until proven otherwise. The proof is that it survives everything that follows. If one step fails, the verdict is "does not hold" — not "to be refined".

## 1. The split

- **Out-of-sample**: the most recent period (≥ 1/3), looked at **once only**, after all calibration. Looking at it twice makes it in-sample.
- **Walk-forward**: calibration windows of N months → test of M months, rolling. The performance that counts is the concatenation of the test windows.
- **Regimes**: measure separately in uptrend, downtrend, range (defined in advance, e.g. by the slope of the MA200). A strategy that only wins in one regime is only validated if its regime filter is in the rules.

## 2. Naive benchmarks

Always compare to:
- buy-and-hold over the same period;
- the same strategy with **random entries** (same exit and sizing rules), 1,000 draws: where does the real result sit in this distribution? If it is below the 95th percentile, the entry adds nothing.

## 3. Sensitivity

Each parameter ±20% and ±50%: plot the metric (Sharpe, Calmar) as a function of the parameter. We want a **plateau**, not a peak. A peak = fitting to noise. The retained parameter pair must be in the middle of the plateau, not at the top.

## 4. Multiple testing

If you tried K variants (parameters, filters, assets) before keeping the best, the best Sharpe is biased upwards. Correct:
- **Deflated Sharpe** (Bailey & López de Prado): adjusts for K trials, sample length, skewness and kurtosis of returns.
- Failing that, simple rule: count K honestly and require that the result stay positive after a penalty of `sqrt(2·ln K)/sqrt(T)` in units of annualised Sharpe, with T the number of years.
- Note K in the report. Not noting it is hiding it.

## 5. Uncertainty

- **Bootstrap** of trades (or of blocks of returns to keep the autocorrelation): 90% interval of the Sharpe and of the max drawdown. An interval that contains zero = no evidence.
- **Number of trades**: below 50, nothing is conclusive; say how many would be needed for the observed effect.
- **Losing streak**: the longest observed vs the one expected for the win rate (binomial) — if the observed one is much shorter, the sample is too lenient.

## 6. The verdict

A table:

| Test | Result | Verdict |
|---|---|---|
| Out-of-sample | Sharpe X vs Y in-sample (−Z%) | holds / does not hold |
| Walk-forward | … | |
| Random entries | percentile … | |
| Sensitivity | plateau / peak | |
| Multiple testing (K = …) | deflated Sharpe … | |
| Bootstrap 90% | [ … ; … ] | |
| Number of trades | … | |

Then a three-line conclusion: holds / does not hold / undetermined; what weakens it most; what would be needed to settle it.

## Rules

- The rejection thresholds are those of the backtest plan, fixed beforehand. They are not moved after seeing the results.
- All tests are reported, including those that fail.
- A p-value states the probability of the data under the null hypothesis, not the probability that the strategy works. Do not oversell it.
