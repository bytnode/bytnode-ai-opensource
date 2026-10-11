"use client";

import { useState, type ReactNode } from "react";
import type { ExchangeAccount, Settings } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import { WEEKDAYS, cadenceOf, frequencyOf, frequencyPhrase, nthPurchase, perMonth, purchasesUntil, schedule, type Cadence, type PlanRow, type Weekday } from "@/lib/plugins/dca/view-model";
import { capitalize } from "@/lib/plugins/shared/frequency-words";
import { useMessages } from "@/lib/i18n/react";
import { dateTag } from "@/lib/i18n/store";
import type { Listed, Priced } from "@/lib/plugins/shared/prices";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Close } from "@/components/ui/icons";
import { fmt } from "../bits";
import { usePluginData } from "../use-plugin-data";
import { PairField } from "../paper-trading/pair-field";
import { badgeClass, when, type Badge } from "./format";

/* ---------------------------------------------------------------------------
   A DCA's configuration, opened at once in the sheet — to make one, or to
   change one — in two steps. First the settings, four short blocks: what
   (the asset and the amount each time), when (how often, from when, until
   when), where, and how it is filed (group, name). "Continue" shows what
   the DCA will do: its schedule in words, what one purchase buys, a
   month's and a year's spending (or the total when it ends), where and in
   which group, the first purchases — and, on a real account, that each one
   waits for the user's click. "Create DCA" makes it. A DCA's asset,
   start and account are set when it is made; a new DCA for another one.
--------------------------------------------------------------------------- */

type Props = {
  settings: Settings;
  /** The DCA being configured; absent: a new one. */
  plan?: PlanRow;
  groups: DcaGroup[];
  accounts: ExchangeAccount[];
  pairs: Listed[] | null;
  pairsUnavailable: string | null;
  paperCash: string;
  /** The group a new DCA goes into. */
  groupId?: string;
  /** Saves; answers why not, or null. */
  onSave: (input: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
};

const DAY = 86_400_000;
/** A weekday's short name in the interface's language ("Mon", « Lun. »):
    1 January 2024 was a Monday, the first of `WEEKDAYS`. */
const dayName = (i: number) => capitalize(new Date(2024, 0, 1 + i).toLocaleDateString(dateTag(), { weekday: "short" }));

/** The sheet scrolled back to its top: each step starts there. */
const toTop = (from: HTMLElement) => from.closest(".wlv-body")?.scrollTo({ top: 0 });

/** The moment the page opened (kept: the render stays pure). */
const openedNow = () => Date.now();
/** A `datetime-local` value, in the machine's time. */
const localInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export function DcaConfig({ settings, plan, groups, accounts, pairs, pairsUnavailable, paperCash, groupId, onSave, onCancel }: Props) {
  const t = useMessages();
  const w = t.dca.config;
  const kinds: Array<{ value: Cadence["kind"]; label: string }> = [
    { value: "daily", label: w.everyDay },
    { value: "weekly", label: w.everyWeek },
    { value: "days", label: w.everyNDays },
    { value: "hours", label: w.everyNHours },
  ];
  const weekdays = WEEKDAYS.map((d, i) => ({ value: d, label: dayName(i) }));
  const editing = plan !== undefined;
  const initial = plan ? cadenceOf(plan.frequency) : ({ kind: "weekly", weekday: "monday", time: "09:00" } as Cadence);
  const [now] = useState(openedNow);
  const [symbol, setSymbol] = useState(plan?.symbol ?? `BTC/${paperCash}`);
  const [amount, setAmount] = useState(plan ? String(plan.quoteAmount) : "");
  const [kind, setKind] = useState<Cadence["kind"]>(initial.kind);
  const [weekday, setWeekday] = useState<Weekday>(initial.kind === "weekly" ? initial.weekday : "monday");
  const [time, setTime] = useState(initial.kind === "daily" || initial.kind === "weekly" ? initial.time : "09:00");
  const [days, setDays] = useState(String(initial.kind === "days" ? initial.days : 7));
  const [hours, setHours] = useState(String(initial.kind === "hours" ? initial.hours : 12));
  const [start, setStart] = useState<"now" | "date">("now");
  const [startDate, setStartDate] = useState(localInput(now + DAY));
  const [end, setEnd] = useState<"never" | "date" | "count">(plan?.endAt ? "date" : "never");
  const [endDate, setEndDate] = useState(plan?.endAt ? localInput(Date.parse(plan.endAt)).slice(0, 10) : new Date(now + 365 * DAY).toISOString().slice(0, 10));
  const [count, setCount] = useState("12");
  /* Where it buys: the paper portfolio, an exchange's test network, or
     real money — the accounts offered are the mode's. */
  const [mode, setMode] = useState<"paper" | "testnet" | "live">(!plan || plan.destination === "paper" ? "paper" : accounts.find((a) => a.id === plan.accountId)?.testnet ? "testnet" : "live");
  const [accountId, setAccountId] = useState(plan?.accountId ?? "");
  const [group, setGroup] = useState(plan?.groupId ?? groupId ?? groups[0]?.id ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* The settings first; "Continue" shows what the DCA will do, to create. */
  const [step, setStep] = useState<"settings" | "review">("settings");

  const quote = usePluginData<Priced>("paper-trading", "quote", settings, { symbol });
  const price = quote.data && "price" in quote.data && quote.data.symbol === symbol ? quote.data.price : undefined;

  const [base, quoteCcy] = symbol.split("/");
  const quoteAmount = Number(amount.replace(/\s/g, "").replace(",", "."));
  const nDays = Math.round(Number(days));
  const nHours = Math.round(Number(hours));
  const cadence: Cadence = kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, weekday, time } : kind === "days" ? { kind, days: nDays } : { kind, hours: nHours };
  const frequency = frequencyOf(cadence);
  const cadenceOk = kind === "days" ? nDays >= 1 && nDays <= 31 : kind === "hours" ? nHours >= 1 && nHours <= 744 : /^\d{2}:\d{2}$/.test(time);

  /* From when (a DCA being changed goes on from now), until when. */
  const startMs = editing ? Math.max(now, Date.parse(plan.startAt) || now) : start === "date" ? Date.parse(startDate) : now;
  const nCount = Math.round(Number(count));
  const endMs = end === "date" ? Date.parse(`${endDate}T23:59:59`) : end === "count" && nCount >= 1 && cadenceOk ? nthPurchase(frequency, startMs, nCount) : undefined;
  const upcoming = cadenceOk && Number.isFinite(startMs) ? schedule(frequency, startMs, endMs, 3) : [];
  const total = cadenceOk && endMs !== undefined && Number.isFinite(endMs) ? purchasesUntil(frequency, startMs, endMs) : undefined;
  const month = cadenceOk ? perMonth(frequency) : 0;
  const destination = mode === "paper" ? "paper" : "exchange";
  const choices = accounts.filter((a) => a.testnet === (mode === "testnet"));
  const account = editing ? accounts.find((a) => a.id === plan.accountId) : mode === "paper" ? undefined : (choices.find((a) => a.id === accountId) ?? choices[0]);
  const badge: Badge = mode === "paper" ? "PAPER" : mode === "testnet" ? "TESTNET" : "LIVE";
  const noAccount = mode === "testnet" ? w.noTestnetAccount : w.noLiveAccount;

  const endOk = end === "never" || (end === "count" ? nCount >= 1 : Number.isFinite(endMs) && endMs! > startMs);
  const ready = !!symbol && quoteAmount > 0 && cadenceOk && endOk && (destination === "paper" || !!account) && !!group && (editing || start === "now" || Number.isFinite(startMs));
  const why = !(quoteAmount > 0) ? w.giveAmount : !cadenceOk ? w.scheduleIncomplete : !endOk ? w.endAfterStart : destination === "exchange" && !account ? noAccount : !group ? w.chooseGroup : null;

  const save = async () => {
    setBusy(true);
    const endAt = endMs !== undefined && Number.isFinite(endMs) ? new Date(endMs).toISOString() : "";
    const input: Record<string, unknown> = editing
      ? { id: plan.id, quoteAmount, frequency, endAt, name, groupId: group }
      : { symbol, quoteAmount, frequency, destination, ...(account ? { accountId: account.id } : {}), groupId: group, name, ...(start === "date" ? { startAt: new Date(startMs).toISOString() } : {}), ...(endAt ? { endAt } : {}) };
    const p = await onSave(input);
    setBusy(false);
    setProblem(p);
  };

  const title = name.trim() || `${base} · ${quoteAmount > 0 ? `${fmt(quoteAmount)} ${quoteCcy}` : quoteCcy}`;
  const day = (at: number) => new Date(at).toLocaleDateString(dateTag(), { day: "numeric", month: "short", year: "numeric" });

  if (step === "review") {
    return (
      <section className="dcv-review" aria-label={w.reviewLabel}>
        <header className="dcv-review-head">
          <span className={badgeClass(badge)}>{badge}</span>
          <h3>{title}</h3>
          <p>{w.buys(`${fmt(quoteAmount)} ${quoteCcy}`, base, frequencyPhrase(frequency))}</p>
        </header>

        <dl className="dcv-facts">
          <Fact label={w.eachTime}>{price !== undefined ? `≈ ${fmt(quoteAmount / price)} ${base}` : `${fmt(quoteAmount)} ${quoteCcy}`}</Fact>
          <Fact label={w.aMonth}>{month ? `${fmt(month * quoteAmount, 0)} ${quoteCcy}` : "—"}</Fact>
          <Fact label={total !== undefined ? w.inAll(total) : w.aYear}>{total !== undefined ? `${fmt(total * quoteAmount, 0)} ${quoteCcy}` : month ? `${fmt(month * quoteAmount * 12.17, 0)} ${quoteCcy}` : "—"}</Fact>
          <Fact label={w.ends}>{end === "never" ? w.never : endMs !== undefined && Number.isFinite(endMs) ? day(endMs) : "—"}</Fact>
          <Fact label={w.buysOn}>{mode === "paper" ? w.paperPortfolio : `${account?.label ?? "—"} · ${mode === "testnet" ? w.testnet : w.live}`}</Fact>
          <Fact label={w.group}>{groups.find((g) => g.id === group)?.name ?? "—"}</Fact>
        </dl>

        <div className="dcv-next">
          <span className="dcv-caption">{editing ? w.nextPurchases : w.firstPurchases}</span>
          <ol>
            {upcoming.map((t) => (
              <li key={t}>{when(new Date(t).toISOString())}</li>
            ))}
          </ol>
        </div>

        <p className={`dcv-sentence${mode === "live" ? " is-real" : ""}`}>
          {mode === "paper"
            ? w.paperSentence(quoteCcy !== paperCash ? paperCash : null)
            : mode === "testnet"
              ? w.testnetSentence(account?.label ?? null)
              : w.liveSentence(account?.label ?? null)}
        </p>

        {problem && <p className="dcv-problem">{problem}</p>}
        <div className="dcv-form-actions">
          <button
            type="button"
            className="dcv-button"
            onClick={(e) => {
              setStep("settings");
              toTop(e.currentTarget);
            }}
          >
            {t.common.back}
          </button>
          <button type="button" className="dcv-button is-primary" disabled={busy} onClick={() => void save()}>
            {busy ? w.saving : editing ? w.saveChanges : w.create}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="dcv-config">
        <Block title={w.what}>
          <Row label={w.asset} hint={price !== undefined ? w.priceNow(`${fmt(price)} ${quoteCcy}`) : quote.data && "error" in quote.data ? quote.data.error : undefined}>
            {editing ? (
              <b className="dcv-fixed">{symbol}</b>
            ) : (
              <PairField value={symbol} pairs={pairs} unavailable={pairsUnavailable} onChange={setSymbol} />
            )}
          </Row>
          <Row label={w.eachTime} hint={price !== undefined && quoteAmount > 0 ? `≈ ${fmt(quoteAmount / price)} ${base}` : undefined}>
            <span className="dcv-amount">
              <input className="wlv-input" inputMode="decimal" placeholder="100" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={w.amountEachTime} />
              <b>{quoteCcy}</b>
            </span>
          </Row>
        </Block>

        <Block title={w.when}>
          <Row label={w.howOften}>
            <Segmented label={w.howOften} value={kind} options={kinds} onChange={setKind} />
          </Row>
          {kind === "weekly" && (
            <Row label={w.day}>
              <Segmented label={w.day} value={weekday} options={weekdays} onChange={setWeekday} />
            </Row>
          )}
          {(kind === "daily" || kind === "weekly") && (
            <Row label={w.at}>
              <input className="wlv-input dcv-time" type="time" aria-label={w.at} value={time} onChange={(e) => setTime(e.target.value)} />
            </Row>
          )}
          {kind === "days" && (
            <Row label={w.every}>
              <span className="dcv-amount dcv-short">
                <input className="wlv-input" inputMode="numeric" aria-label={w.everyHowManyDays} value={days} onChange={(e) => setDays(e.target.value)} />
                <b>{w.days}</b>
              </span>
            </Row>
          )}
          {kind === "hours" && (
            <Row label={w.every}>
              <span className="dcv-amount dcv-short">
                <input className="wlv-input" inputMode="numeric" aria-label={w.everyHowManyHours} value={hours} onChange={(e) => setHours(e.target.value)} />
                <b>{w.hours}</b>
              </span>
            </Row>
          )}
          <Row label={w.starts}>
            {editing ? (
              <b className="dcv-fixed">{w.started(when(plan.startAt))}</b>
            ) : (
              <span className="dcv-inline">
                <Segmented
                  label={w.starts}
                  value={start}
                  options={[
                    { value: "now", label: w.now },
                    { value: "date", label: w.onADate },
                  ]}
                  onChange={setStart}
                />
                {start === "date" && <input className="wlv-input dcv-date" type="datetime-local" aria-label={w.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
              </span>
            )}
          </Row>
          <Row label={w.ends}>
            <span className="dcv-inline">
              <Segmented
                label={w.ends}
                value={end}
                options={[
                  { value: "never", label: w.never },
                  { value: "date", label: w.onADate },
                  { value: "count", label: w.afterNPurchases },
                ]}
                onChange={setEnd}
              />
              {end === "date" && <input className="wlv-input dcv-date" type="date" aria-label={w.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
              {end === "count" && (
                <span className="dcv-amount dcv-short">
                  <input className="wlv-input" inputMode="numeric" aria-label={w.numberOfPurchases} value={count} onChange={(e) => setCount(e.target.value)} />
                  <b>{w.purchases}</b>
                </span>
              )}
            </span>
          </Row>
        </Block>

        <Block title={w.where}>
          {editing ? (
            <Row label={w.buysOn}>
              <span className="dcv-inline">
                <span className={badgeClass(badge)}>{badge}</span>
                <b className="dcv-fixed">{destination === "paper" ? w.paperPortfolio : (account?.label ?? t.dca.sheet.removedAccount)}</b>
              </span>
            </Row>
          ) : (
            <>
              <Row label={w.mode} hint={mode === "paper" ? w.paperHint : mode === "testnet" ? w.testnetHint : w.liveHint}>
                <Segmented
                  label={w.mode}
                  value={mode}
                  options={[
                    { value: "paper", label: w.paper },
                    { value: "testnet", label: w.testnetMode },
                    { value: "live", label: w.liveMode },
                  ]}
                  onChange={setMode}
                />
              </Row>
              {mode !== "paper" && (
                <Row label={w.account} hint={choices.length ? undefined : noAccount}>
                  <span className="dcv-inline">
                    <span className={badgeClass(badge)}>{badge}</span>
                    <Select id="dca-account" label={w.account} value={account?.id ?? ""} placeholder={mode === "testnet" ? w.noTestnetChoice : w.noLiveChoice} options={choices.map((a) => ({ value: a.id, label: a.label }))} onChange={setAccountId} />
                  </span>
                </Row>
              )}
            </>
          )}
        </Block>

        <Block title={w.filed}>
          <Row label={w.group}>
            <Select id="dca-group" label={w.group} value={group} placeholder={w.noGroupChoice} options={groups.map((g) => ({ value: g.id, label: g.name }))} onChange={setGroup} />
          </Row>
          <Row label={w.name}>
            <input className="wlv-input" placeholder={w.namePlaceholder(`${base} ${frequencyPhrase(frequency)}`)} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={w.name} />
          </Row>
        </Block>

      <footer className="dcv-config-foot">
        {!ready && why && <span className="dcv-config-why">{why}</span>}
        <button type="button" className="dcv-button" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          className="dcv-button is-primary"
          disabled={!ready}
          onClick={(e) => {
            setProblem(null);
            setStep("review");
            toTop(e.currentTarget);
          }}
        >
          {w.continue}
        </button>
      </footer>
    </div>
  );
}

/** The header of the configuration (the sheet's), with its close button. */
export function ConfigHead({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  const t = useMessages();
  return (
    <header className="wlv-head">
      <div className="wlv-title-block">
        <h2 className="wlv-sheet-title">
          <span className="pv-ink">{title}</span>
        </h2>
        <p className="wlv-sheet-sub">{sub}</p>
      </div>
      <button type="button" className="wlv-icon" onClick={onClose} aria-label={t.dca.config.closeConfig} title={t.common.close}>
        <Close />
      </button>
    </header>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dcv-block">
      <h3 className="dcv-block-head">{title}</h3>
      <div className="dcv-rows">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="dcv-row">
      <span className="dcv-row-label">{label}</span>
      <div className="dcv-row-control">
        {children}
        {hint && <small className="dcv-row-hint">{hint}</small>}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dcv-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
