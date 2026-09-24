"use client";

import { useState, type ReactNode } from "react";
import type { ExchangeAccount, Settings } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import { WEEKDAYS, cadenceOf, frequencyOf, frequencyWords, nthPurchase, perMonth, purchasesUntil, schedule, type Cadence, type PlanRow, type Weekday } from "@/lib/plugins/dca/view-model";
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
   change one. Left, every setting in its section: the asset, the amount
   each time, the schedule (how often, from when, until when), where it
   buys, its group and its name. Right, what it will do, read live from
   those settings: the price now and what one purchase buys, the next five
   dates, what it spends a month, in all when it ends, and — on a real
   account — that each purchase waits for the user's click. A DCA's asset,
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

const KINDS: Array<{ value: Cadence["kind"]; label: string }> = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "days", label: "Every N days" },
  { value: "hours", label: "Every N hours" },
];
const DAYS = WEEKDAYS.map((d) => ({ value: d, label: d.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) }));
const DAY = 86_400_000;

/** The moment the page opened (kept: the render stays pure). */
const openedNow = () => Date.now();
/** A `datetime-local` value, in the machine's time. */
const localInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export function DcaConfig({ settings, plan, groups, accounts, pairs, pairsUnavailable, paperCash, groupId, onSave, onCancel }: Props) {
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
  const [destination, setDestination] = useState<"paper" | "exchange">(plan?.destination ?? "paper");
  const [accountId, setAccountId] = useState(plan?.accountId ?? accounts[0]?.id ?? "");
  const [group, setGroup] = useState(plan?.groupId ?? groupId ?? groups[0]?.id ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  const upcoming = cadenceOk && Number.isFinite(startMs) ? schedule(frequency, startMs, endMs, 5) : [];
  const total = cadenceOk && endMs !== undefined && Number.isFinite(endMs) ? purchasesUntil(frequency, startMs, endMs) : undefined;
  const month = cadenceOk ? perMonth(frequency) : 0;
  const account = accounts.find((a) => a.id === accountId);
  const badge: Badge = destination === "paper" ? "PAPER" : account?.testnet ? "TESTNET" : "LIVE";

  const endOk = end === "never" || (end === "count" ? nCount >= 1 : Number.isFinite(endMs) && endMs! > startMs);
  const ready = !!symbol && quoteAmount > 0 && cadenceOk && endOk && (destination === "paper" || !!account) && !!group && (editing || start === "now" || Number.isFinite(startMs));
  const why = !(quoteAmount > 0) ? "Give the amount spent each time." : !cadenceOk ? "The schedule is not complete." : !endOk ? "The end must come after the start." : destination === "exchange" && !account ? "Choose the exchange account." : !group ? "Choose a group." : null;

  const save = async () => {
    setBusy(true);
    const endAt = endMs !== undefined && Number.isFinite(endMs) ? new Date(endMs).toISOString() : "";
    const input: Record<string, unknown> = editing
      ? { id: plan.id, quoteAmount, frequency, endAt, name, note, groupId: group }
      : { symbol, quoteAmount, frequency, destination, ...(destination === "exchange" ? { accountId } : {}), groupId: group, name, note, ...(start === "date" ? { startAt: new Date(startMs).toISOString() } : {}), ...(endAt ? { endAt } : {}) };
    const p = await onSave(input);
    setBusy(false);
    setProblem(p);
  };

  return (
    <div className="dcv-config">
      <div className="dcv-config-main">
        <Block title="Asset" sub={editing ? "set when the DCA was made" : "what each purchase buys"}>
          <Row label="Pair">
            {editing ? (
              <b className="dcv-fixed">{symbol}</b>
            ) : (
              <PairField value={symbol} pairs={pairs} unavailable={pairsUnavailable} onChange={setSymbol} />
            )}
          </Row>
          <Row label="Price now" hint={quote.data && "error" in quote.data ? quote.data.error : "BytNode, else an exchange account"}>
            <b className="dcv-fixed">{price !== undefined ? `${fmt(price)} ${quoteCcy}` : quote.loading ? "Reading…" : "—"}</b>
          </Row>
        </Block>

        <Block title="Amount" sub="spent at each purchase">
          <Row label="Each time" hint={price !== undefined && quoteAmount > 0 ? `≈ ${fmt(quoteAmount / price)} ${base} at today's price` : undefined}>
            <span className="dcv-amount">
              <input className="wlv-input" inputMode="decimal" placeholder="100" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount each time" />
              <b>{quoteCcy}</b>
            </span>
          </Row>
        </Block>

        <Block title="Schedule" sub="the machine's local time; purchases run while the app is open">
          <Row label="How often">
            <Segmented label="How often" value={kind} options={KINDS} onChange={setKind} />
          </Row>
          {kind === "weekly" && (
            <Row label="Day">
              <Segmented label="Day" value={weekday} options={DAYS} onChange={setWeekday} />
            </Row>
          )}
          {(kind === "daily" || kind === "weekly") && (
            <Row label="At">
              <input className="wlv-input dcv-time" type="time" aria-label="At" value={time} onChange={(e) => setTime(e.target.value)} />
            </Row>
          )}
          {kind === "days" && (
            <Row label="Every" hint="1 to 31 days">
              <span className="dcv-amount dcv-short">
                <input className="wlv-input" inputMode="numeric" aria-label="Every how many days" value={days} onChange={(e) => setDays(e.target.value)} />
                <b>days</b>
              </span>
            </Row>
          )}
          {kind === "hours" && (
            <Row label="Every" hint="at least every hour">
              <span className="dcv-amount dcv-short">
                <input className="wlv-input" inputMode="numeric" aria-label="Every how many hours" value={hours} onChange={(e) => setHours(e.target.value)} />
                <b>hours</b>
              </span>
            </Row>
          )}
          <Row label="Starts">
            {editing ? (
              <b className="dcv-fixed">{`started ${when(plan.startAt)}`}</b>
            ) : (
              <span className="dcv-inline">
                <Segmented
                  label="Starts"
                  value={start}
                  options={[
                    { value: "now", label: "Now" },
                    { value: "date", label: "On a date" },
                  ]}
                  onChange={setStart}
                />
                {start === "date" && <input className="wlv-input dcv-date" type="datetime-local" aria-label="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
              </span>
            )}
          </Row>
          <Row label="Ends">
            <span className="dcv-inline">
              <Segmented
                label="Ends"
                value={end}
                options={[
                  { value: "never", label: "Never" },
                  { value: "date", label: "On a date" },
                  { value: "count", label: "After N purchases" },
                ]}
                onChange={setEnd}
              />
              {end === "date" && <input className="wlv-input dcv-date" type="date" aria-label="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
              {end === "count" && (
                <span className="dcv-amount dcv-short">
                  <input className="wlv-input" inputMode="numeric" aria-label="Number of purchases" value={count} onChange={(e) => setCount(e.target.value)} />
                  <b>purchases</b>
                </span>
              )}
            </span>
          </Row>
        </Block>

        <Block title="Where" sub={editing ? "set when the DCA was made" : "simulated, or real money"}>
          {editing ? (
            <Row label="Buys on">
              <span className="dcv-inline">
                <span className={badgeClass(badge)}>{badge}</span>
                <b className="dcv-fixed">{destination === "paper" ? "Paper portfolio" : (account?.label ?? "a removed account")}</b>
              </span>
            </Row>
          ) : (
            <>
              <Row label="Buys on">
                <Segmented
                  label="Where"
                  value={destination}
                  options={[
                    { value: "paper", label: "Paper portfolio" },
                    { value: "exchange", label: "Exchange account" },
                  ]}
                  onChange={setDestination}
                />
              </Row>
              {destination === "exchange" && (
                <Row label="Account" hint={accounts.length ? undefined : "Add an exchange account in Settings → Auth."}>
                  <Select id="dca-account" label="Account" value={accountId} placeholder="No exchange account" options={accounts.map((a) => ({ value: a.id, label: `${a.label} — ${a.testnet ? "TESTNET" : "LIVE"}` }))} onChange={setAccountId} />
                </Row>
              )}
            </>
          )}
        </Block>

        <Block title="Group and name" sub="how it is filed and called">
          <Row label="Group">
            <Select id="dca-group" label="Group" value={group} placeholder="No group — make one first" options={groups.map((g) => ({ value: g.id, label: g.name }))} onChange={setGroup} />
          </Row>
          <Row label="Name" hint="optional">
            <input className="wlv-input" placeholder={`${base} ${frequencyWords(frequency).replace(/^Every/, "every")}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          </Row>
          <Row label="Note" hint="optional">
            <input className="wlv-input" placeholder="Why this DCA" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          </Row>
        </Block>
      </div>

      {/* What it will do, live. */}
      <aside className="dcv-summary" aria-label="What this DCA will do">
        <header className="dcv-summary-head">
          <span className={badgeClass(badge)}>{badge}</span>
          <b>{name.trim() || `${base} · ${quoteAmount > 0 ? `${quoteAmount} ${quoteCcy}` : quoteCcy}`}</b>
        </header>
        <dl className="dcv-facts">
          <Fact label="Buys">{`${quoteAmount > 0 ? `${fmt(quoteAmount)} ${quoteCcy}` : "—"} of ${base}`}</Fact>
          <Fact label="Each time">{price !== undefined && quoteAmount > 0 ? `≈ ${fmt(quoteAmount / price)} ${base}` : "—"}</Fact>
          <Fact label="How often">{cadenceOk ? frequencyWords(frequency) : "—"}</Fact>
          <Fact label={editing ? "Next purchase" : "First purchase"}>{upcoming[0] ? when(new Date(upcoming[0]).toISOString()) : "—"}</Fact>
          <Fact label="Ends">{end === "never" ? "never — until you pause it" : total !== undefined ? `${when(new Date(endMs!).toISOString())} · ${total} purchase${total === 1 ? "" : "s"}` : "—"}</Fact>
          <Fact label="A month">{quoteAmount > 0 && month ? `≈ ${fmt(month * quoteAmount, 2)} ${quoteCcy} · ${fmt(month, 1)} purchases` : "—"}</Fact>
          <Fact label={total !== undefined ? "In all" : "A year"}>{quoteAmount > 0 ? (total !== undefined ? `${fmt(total * quoteAmount, 2)} ${quoteCcy}` : month ? `≈ ${fmt(month * quoteAmount * 12.17, 2)} ${quoteCcy}` : "—") : "—"}</Fact>
          <Fact label="Group">{groups.find((g) => g.id === group)?.name ?? "—"}</Fact>
        </dl>

        <div className="dcv-next">
          <span className="dcv-caption">Next purchases</span>
          {upcoming.length ? (
            <ol>
              {upcoming.map((t) => (
                <li key={t}>{when(new Date(t).toISOString())}</li>
              ))}
            </ol>
          ) : (
            <p className="dcv-quiet">None with these settings.</p>
          )}
        </div>

        <p className={`dcv-sentence${destination === "exchange" ? " is-real" : ""}`}>
          {destination === "paper"
            ? `Simulated: bought automatically in the paper portfolio, never real money.${quoteCcy !== paperCash ? ` The paper portfolio trades against ${paperCash}.` : ""}`
            : `Real money on ${account?.label ?? "the account"}: each purchase is checked (market open, minimum, balance), then waits for your click in the notifications — nothing is bought without it.`}
        </p>

        {(problem ?? (!ready ? why : null)) && <p className="dcv-problem">{problem ?? why}</p>}
        <div className="dcv-form-actions">
          <button type="button" className="dcv-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dcv-button is-primary" disabled={!ready || busy} onClick={() => void save()}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create DCA"}
          </button>
        </div>
      </aside>
    </div>
  );
}

/** The header of the configuration (the sheet's), with its close button. */
export function ConfigHead({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <header className="wlv-head">
      <div className="wlv-title-block">
        <h2 className="wlv-sheet-title">
          <span className="pv-ink">{title}</span>
        </h2>
        <p className="wlv-sheet-sub">{sub}</p>
      </div>
      <button type="button" className="wlv-icon" onClick={onClose} aria-label="Close the configuration" title="Close">
        <Close />
      </button>
    </header>
  );
}

function Block({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="dcv-block">
      <header className="dcv-block-head">
        <h3>{title}</h3>
        <span>{sub}</span>
      </header>
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
