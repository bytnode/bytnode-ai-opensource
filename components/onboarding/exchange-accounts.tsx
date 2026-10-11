"use client";

import { useState } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import { EXCHANGES, exchangeInfo } from "@/lib/tools/exchange/catalog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Check, Eye, EyeOff, Spinner } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";
import { currentMessages } from "@/lib/i18n/store";

/* ---------------------------------------------------------------------------
   The exchange accounts: the list, and the form to add one.

   An account = an exchange, a label the agent will use, a key and its
   secret (a passphrase for some), and "test network" when the exchange has
   one. Everything stays in the browser; "Test" opens a server-side
   connection and reads the balance, keeping nothing.
--------------------------------------------------------------------------- */

type Props = {
  value: ExchangeAccount[];
  onChange: (accounts: ExchangeAccount[]) => void;
  /** The first launch's setup: the form already open while there is no
      account (2026-10-09). */
  startOpen?: boolean;
  /** The setup's way on, beside « Add », on the right: « Skip », « Skip and
      start » (2026-10-09). */
  aside?: { label: string; onClick: () => void };
};

type Check = { state: "idle" } | { state: "checking" } | { state: "ok"; label: string } | { state: "bad"; message: string };

async function testAccount(account: ExchangeAccount): Promise<Check> {
  try {
    const res = await fetch("/api/exchange/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    return json.ok ? { state: "ok", label: json.message ?? "" } : { state: "bad", message: json.message ?? currentMessages().onboarding.exchanges.refused };
  } catch {
    return { state: "bad", message: currentMessages().onboarding.serverUnreachable };
  }
}

export function ExchangeAccounts({ value, onChange, startOpen = false, aside }: Props) {
  const t = useMessages().onboarding.exchanges;
  const [adding, setAdding] = useState(startOpen && value.length === 0);
  return (
    <div className="xch">
      <div className="xch-head">
        <span className="field-label">{t.title}</span>
        <span className="field-hint">{t.hint}</span>
      </div>
      {value.length > 0 && (
        <ul className="xch-list">
          {value.map((a) => (
            <AccountRow key={a.id} account={a} onRemove={() => onChange(value.filter((x) => x.id !== a.id))} />
          ))}
        </ul>
      )}
      {adding ? (
        <AddForm
          existing={value}
          aside={aside}
          onCancel={startOpen && value.length === 0 ? undefined : () => setAdding(false)}
          onAdd={(a) => {
            onChange([...value, a]);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
          {t.addAccount}
        </button>
      )}
    </div>
  );
}

function AccountRow({ account, onRemove }: { account: ExchangeAccount; onRemove: () => void }) {
  const m = useMessages();
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [confirm, setConfirm] = useState(false);
  const info = exchangeInfo(account.exchange);
  return (
    <li className="xch-row">
      <span className={`xch-badge${account.testnet ? "" : " is-live"}`}>{account.testnet ? m.onboarding.agent.testnet : m.onboarding.agent.live}</span>
      <span className="xch-label">{account.label}</span>
      <span className="xch-exchange">{info?.label ?? account.exchange}</span>
      <span className="xch-status">
        {check.state === "ok" && <span className="xch-ok">✓ {check.label}</span>}
        {check.state === "bad" && <span className="xch-bad">{check.message}</span>}
      </span>
      <button
        type="button"
        className={`btn btn-sm${check.state === "ok" ? " is-ok" : ""}`}
        disabled={check.state === "checking"}
        onClick={async () => {
          setCheck({ state: "checking" });
          setCheck(await testAccount(account));
        }}
      >
        {check.state === "checking" ? <Spinner /> : check.state === "ok" ? <Check /> : null}
        {m.onboarding.test}
      </button>
      {confirm ? (
        <>
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
            {m.common.delete}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
            {m.onboarding.keep}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
          {m.common.remove}
        </button>
      )}
    </li>
  );
}

/** `onCancel` absent: the form is the step itself (the setup's first
    account), nothing to cancel back to. */
function AddForm({ existing, onAdd, onCancel, aside }: { existing: ExchangeAccount[]; onAdd: (a: ExchangeAccount) => void; onCancel?: () => void; aside?: { label: string; onClick: () => void } }) {
  const m = useMessages();
  const t = m.onboarding.exchanges;
  const [exchange, setExchange] = useState(EXCHANGES[0].id);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [testnet, setTestnet] = useState(false);
  const info = exchangeInfo(exchange);
  /* The suggested name follows the chosen exchange: "Bybit-main" for Bybit. */
  const suggested = `${info?.label ?? exchange}-main`;
  /* Left empty, the name shown as an example is the name. */
  const cleanLabel = label.trim() || suggested;
  const duplicate = existing.some((a) => a.label.toLowerCase() === cleanLabel.toLowerCase());
  const [problem, setProblem] = useState<string | null>(null);
  /* What is missing, said when Add is pressed. */
  const why = duplicate ? t.whyDuplicate : !apiKey.trim() ? t.whyKey : !secret.trim() ? t.whySecret : info?.password && !password.trim() ? t.whyPassphrase(info.label) : null;
  /* The exchange's note, in the interface's language when it has one. */
  const note = (t.notes as Record<string, string | undefined>)[exchange] ?? info?.note;

  const submit = () => {
    if (why) return setProblem(why);
    /* The id is stamped here, on click — never during render. */
    onAdd({ id: crypto.randomUUID(), exchange, label: cleanLabel, apiKey: apiKey.trim(), secret: secret.trim(), password: password.trim(), testnet: !!info?.testnet && testnet });
  };

  return (
    <div className="xch-form">
      <Field id="xch-exchange" label={t.exchange} hint={note}>
        <Select
          id="xch-exchange"
          label={t.exchangeList}
          value={exchange}
          options={EXCHANGES.map((e) => ({
            value: e.id,
            label: e.label,
            meta:
              [
                e.futures === "none" ? t.spotOnly : e.futures === "read" ? t.futuresReadOnly : t.spotAndFutures,
                e.testnet ? t.testnet : null,
                e.password ? t.passphrase : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
          }))}
          onChange={(id) => {
            setExchange(id);
            if (!exchangeInfo(id)?.testnet) setTestnet(false);
          }}
        />
      </Field>
      <Field id="xch-label" label={t.accountName} hint={t.accountNameHint(suggested)} error={duplicate ? t.duplicate : undefined}>
        <input id="xch-label" className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={suggested} />
      </Field>
      <Field id="xch-key" label={t.apiKey}>
        <SecretInput id="xch-key" value={apiKey} onChange={setApiKey} />
      </Field>
      <Field id="xch-secret" label={t.secret}>
        <SecretInput id="xch-secret" value={secret} onChange={setSecret} />
      </Field>
      {info?.password && (
        <Field id="xch-pass" label={t.passphraseLabel}>
          <SecretInput id="xch-pass" value={password} onChange={setPassword} />
        </Field>
      )}
      <label className={`xch-check${info?.testnet ? "" : " is-off"}`}>
        <input type="checkbox" checked={testnet} disabled={!info?.testnet} onChange={(e) => setTestnet(e.target.checked)} />
        {t.testnetCheck(!!info?.testnet)}
      </label>
      <div className="xch-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={submit}>
          {m.common.add}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            {m.common.cancel}
          </button>
        )}
        {aside && (
          <button type="button" className="btn btn-sm btn-ghost xch-aside" onClick={aside.onClick}>
            {aside.label}
          </button>
        )}
      </div>
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}

/* A secret's field: its own eye at the field's right end, shown only once
   something is typed — one per field, never one for all (user request,
   2026-10-08). */
export function SecretInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const m = useMessages();
  const [shown, setShown] = useState(false);
  return (
    <div className="ob-key is-solo">
      <input id={id} className="field-input mono" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
      {value ? (
        <button type="button" className="ob-key-eye" onClick={() => setShown(!shown)} aria-label={shown ? m.common.hide : m.common.show}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
      ) : null}
    </div>
  );
}
