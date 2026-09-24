"use client";

import { useState } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import type { DcaGroup } from "@/lib/plugins/dca/groups";
import { WEEKDAYS, frequencyOf, frequencyWords, type Cadence, type Weekday } from "@/lib/plugins/dca/view-model";
import type { Listed } from "@/lib/plugins/shared/prices";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { PairField } from "../paper-trading/pair-field";

/* ---------------------------------------------------------------------------
   A new plan, in the sheet: the pair (BytNode's list, as the paper
   ticket's), the amount spent each time, how often — every day, every week
   on a day, or every N days, at a time — where it buys, and the group it is
   listed under. A sentence says what will happen before "Create". A real
   plan never buys by itself: each due date is a confirmation.
--------------------------------------------------------------------------- */

type Props = {
  groups: DcaGroup[];
  accounts: ExchangeAccount[];
  pairs: Listed[] | null;
  pairsUnavailable: string | null;
  paperCash: string;
  /** The group it opens in (from a group's "Add a DCA"); else the first. */
  groupId?: string;
  /** Creates the plan; answers why not, or null. */
  onCreate: (input: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
};

const KINDS = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "days", label: "Every N days" },
] as const;
const DAYS = WEEKDAYS.map((d) => ({ value: d, label: d.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) }));

export function NewPlan({ groups, accounts, pairs, pairsUnavailable, paperCash, groupId, onCreate, onCancel }: Props) {
  const [symbol, setSymbol] = useState(`BTC/${paperCash}`);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<Cadence["kind"]>("weekly");
  const [weekday, setWeekday] = useState<Weekday>("monday");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState("7");
  const [destination, setDestination] = useState<"paper" | "exchange">("paper");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [group, setGroup] = useState(groupId ?? groups[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const quoteAmount = Number(amount.replace(/\s/g, "").replace(",", "."));
  const everyDays = Math.round(Number(days));
  const cadence: Cadence = kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, weekday, time } : { kind, days: everyDays };
  const frequency = frequencyOf(cadence);
  const account = accounts.find((a) => a.id === accountId);
  const [base, quote] = symbol.split("/");
  const ready = !!symbol && quoteAmount > 0 && (kind !== "days" || (everyDays >= 1 && everyDays <= 31)) && (kind === "days" || /^\d{2}:\d{2}$/.test(time)) && (destination === "paper" || !!account);

  const create = async () => {
    setBusy(true);
    const p = await onCreate({ symbol, quoteAmount, frequency, destination, ...(destination === "exchange" ? { accountId } : {}), ...(group ? { groupId: group } : {}) });
    setBusy(false);
    setProblem(p);
  };

  return (
    <form
      className="dcv-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void create();
      }}
    >
      <div className="dcv-field">
        <span className="dcv-caption">Asset</span>
        <PairField value={symbol} pairs={pairs} unavailable={pairsUnavailable} onChange={setSymbol} />
      </div>

      <label className="dcv-field">
        <span className="dcv-caption">Amount each time</span>
        <span className="dcv-amount">
          <input className="wlv-input" inputMode="decimal" placeholder="100" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <b>{quote}</b>
        </span>
      </label>

      <div className="dcv-field">
        <span className="dcv-caption">How often</span>
        <Segmented label="How often" value={kind} options={[...KINDS]} onChange={setKind} />
        <div className="dcv-when">
          {kind === "weekly" && <Segmented label="Day" value={weekday} options={DAYS} onChange={setWeekday} />}
          {kind === "days" && (
            <span className="dcv-amount dcv-days">
              <input className="wlv-input" inputMode="numeric" aria-label="Every how many days" value={days} onChange={(e) => setDays(e.target.value)} />
              <b>days</b>
            </span>
          )}
          {kind !== "days" && <input className="wlv-input dcv-time" type="time" aria-label="At" value={time} onChange={(e) => setTime(e.target.value)} />}
        </div>
      </div>

      <div className="dcv-field">
        <span className="dcv-caption">Where</span>
        <Segmented
          label="Where"
          value={destination}
          options={[
            { value: "paper", label: "Paper — simulated" },
            { value: "exchange", label: "Exchange — real" },
          ]}
          onChange={setDestination}
        />
        {destination === "exchange" && (
          <Select id="dca-account" label="Account" value={accountId} placeholder="No exchange account — add one in Settings" options={accounts.map((a) => ({ value: a.id, label: `${a.label} — ${a.testnet ? "TESTNET" : "LIVE"}` }))} onChange={setAccountId} />
        )}
      </div>

      <div className="dcv-field">
        <span className="dcv-caption">Group</span>
        <Select id="dca-group" label="Group" value={group} options={[{ value: "", label: "No group — listed on its own" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} onChange={setGroup} />
      </div>

      <p className={`dcv-sentence${destination === "exchange" ? " is-real" : ""}`}>
        Buys {quoteAmount > 0 ? `${quoteAmount} ${quote}` : quote} of {base} {frequencyWords(frequency).replace(/^Every/, "every")}
        {destination === "paper" ? " — in the paper portfolio, bought automatically." : account ? ` — on ${account.label} (${account.testnet ? "TESTNET" : "LIVE"}): each purchase waits for your confirmation in the notifications, nothing is bought without your click.` : " — choose the account."}
        {destination === "paper" && quote !== paperCash ? ` The paper portfolio trades against ${paperCash}.` : ""}
      </p>

      {problem && <p className="dcv-problem">{problem}</p>}
      <div className="dcv-form-actions">
        <button type="button" className="dcv-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="dcv-button is-primary" disabled={!ready || busy}>
          {busy ? "Creating…" : "Create DCA"}
        </button>
      </div>
    </form>
  );
}
