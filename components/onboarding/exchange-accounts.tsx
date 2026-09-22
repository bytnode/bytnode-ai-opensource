"use client";

import { useState } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import { EXCHANGES, exchangeInfo } from "@/lib/tools/exchange/catalog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Check, Eye, EyeOff, Spinner } from "@/components/ui/icons";

/* ---------------------------------------------------------------------------
   The exchange accounts: the list, and the form to add one.

   An account = an exchange, a label the agent will use, a key and its
   secret (a passphrase for some), and "test network" when the exchange has
   one. Everything stays in the browser; "Test" opens a server-side
   connection and reads the balance, keeping nothing.
--------------------------------------------------------------------------- */

type Props = { value: ExchangeAccount[]; onChange: (accounts: ExchangeAccount[]) => void };

type Check = { state: "idle" } | { state: "checking" } | { state: "ok"; label: string } | { state: "bad"; message: string };

async function testAccount(account: ExchangeAccount): Promise<Check> {
  try {
    const res = await fetch("/api/exchange/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    return json.ok ? { state: "ok", label: json.message ?? "" } : { state: "bad", message: json.message ?? "Account refused." };
  } catch {
    return { state: "bad", message: "Could not reach the server." };
  }
}

export function ExchangeAccounts({ value, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="xch">
      <div className="xch-head">
        <span className="field-label">Exchange accounts</span>
        <span className="field-hint">Binance, Bybit, OKX… The agents you attach to them will be able to read balances, place orders and move funds between spot and futures — every order is submitted to you first.</span>
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
          onCancel={() => setAdding(false)}
          onAdd={(a) => {
            onChange([...value, a]);
            setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
          Add an account
        </button>
      )}
    </div>
  );
}

function AccountRow({ account, onRemove }: { account: ExchangeAccount; onRemove: () => void }) {
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [confirm, setConfirm] = useState(false);
  const info = exchangeInfo(account.exchange);
  return (
    <li className="xch-row">
      <span className={`xch-badge${account.testnet ? "" : " is-live"}`}>{account.testnet ? "TESTNET" : "LIVE"}</span>
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
        Test
      </button>
      {confirm ? (
        <>
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
            Delete
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
            Keep
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
          Remove
        </button>
      )}
    </li>
  );
}

function AddForm({ existing, onAdd, onCancel }: { existing: ExchangeAccount[]; onAdd: (a: ExchangeAccount) => void; onCancel: () => void }) {
  const [exchange, setExchange] = useState(EXCHANGES[0].id);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [testnet, setTestnet] = useState(false);
  const [shown, setShown] = useState(false);
  const info = exchangeInfo(exchange);
  /* The suggested name follows the chosen exchange: "Bybit-main" for Bybit. */
  const suggested = `${info?.label ?? exchange}-main`;
  const cleanLabel = label.trim();
  const duplicate = existing.some((a) => a.label.toLowerCase() === cleanLabel.toLowerCase());
  const valid = cleanLabel && !duplicate && apiKey.trim() && secret.trim() && (!info?.password || password.trim());

  const submit = () => {
    if (!valid) return;
    /* The id is stamped here, on click — never during render. */
    onAdd({ id: crypto.randomUUID(), exchange, label: cleanLabel, apiKey: apiKey.trim(), secret: secret.trim(), password: password.trim(), testnet: !!info?.testnet && testnet });
  };

  return (
    <div className="xch-form">
      <Field id="xch-exchange" label="Exchange" hint={info?.note}>
        <Select
          id="xch-exchange"
          label="Exchanges"
          value={exchange}
          options={EXCHANGES.map((e) => ({
            value: e.id,
            label: e.label,
            meta:
              [
                e.futures === "none" ? "spot only" : e.futures === "read" ? "futures read-only" : "spot + futures",
                e.testnet ? "testnet" : null,
                e.password ? "passphrase" : null,
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
      <Field id="xch-label" label="Account name" hint={`The one the agent will use: "${suggested}".`} error={duplicate ? "An account already has this name." : undefined}>
        <input id="xch-label" className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={suggested} />
      </Field>
      <Field id="xch-key" label="API key">
        <div className="ob-key">
          <input id="xch-key" className="field-input mono" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <button type="button" className="ob-key-eye" onClick={() => setShown(!shown)} aria-label={shown ? "Hide" : "Show"}>
            {shown ? <EyeOff /> : <Eye />}
          </button>
        </div>
      </Field>
      <Field id="xch-secret" label="Secret">
        <input id="xch-secret" className="field-input mono" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} />
      </Field>
      {info?.password && (
        <Field id="xch-pass" label="Passphrase">
          <input id="xch-pass" className="field-input mono" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      <label className={`xch-check${info?.testnet ? "" : " is-off"}`}>
        <input type="checkbox" checked={testnet} disabled={!info?.testnet} onChange={(e) => setTestnet(e.target.checked)} />
        Test network (testnet){info?.testnet ? "" : " — not offered by this exchange"}
      </label>
      <div className="xch-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={!valid} onClick={submit}>
          Add
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
