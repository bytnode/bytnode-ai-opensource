"use client";

import { useState } from "react";
import type { ExchangeAccount } from "@/lib/domain/types";
import { EXCHANGES, exchangeInfo } from "@/lib/tools/exchange/catalog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Check, Eye, EyeOff, Spinner } from "@/components/ui/icons";

/* ---------------------------------------------------------------------------
   Les comptes d'exchange : la liste, et le formulaire pour en ajouter un.

   Un compte = un exchange, un label que l'agent emploiera, une cle et son
   secret (une passphrase pour certains), et « reseau de test » quand
   l'exchange en a un. Tout reste dans le navigateur ; « Tester » ouvre une
   connexion cote serveur et lit le solde, sans rien garder.
--------------------------------------------------------------------------- */

type Props = { value: ExchangeAccount[]; onChange: (accounts: ExchangeAccount[]) => void };

type Check = { state: "idle" } | { state: "checking" } | { state: "ok"; label: string } | { state: "bad"; message: string };

async function testAccount(account: ExchangeAccount): Promise<Check> {
  try {
    const res = await fetch("/api/exchange/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
    const json = (await res.json()) as { ok?: boolean; message?: string };
    return json.ok ? { state: "ok", label: json.message ?? "" } : { state: "bad", message: json.message ?? "Compte refusé." };
  } catch {
    return { state: "bad", message: "Impossible de joindre le serveur." };
  }
}

export function ExchangeAccounts({ value, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="xch">
      <div className="xch-head">
        <span className="field-label">Comptes exchange</span>
        <span className="field-hint">Binance, Bybit, OKX… Les agents que vous y rattachez pourront lire les soldes, passer des ordres et déplacer des fonds entre spot et futures — chaque ordre vous est demandé.</span>
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
          Ajouter un compte
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
      <span className={`xch-badge${account.testnet ? "" : " is-live"}`}>{account.testnet ? "TESTNET" : "RÉEL"}</span>
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
        Tester
      </button>
      {confirm ? (
        <>
          <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
            Supprimer
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
            Garder
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
          Retirer
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
  /* Le nom propose suit l'exchange choisi : « Bybit-main » pour Bybit. */
  const suggested = `${info?.label ?? exchange}-main`;
  const cleanLabel = label.trim();
  const duplicate = existing.some((a) => a.label.toLowerCase() === cleanLabel.toLowerCase());
  const valid = cleanLabel && !duplicate && apiKey.trim() && secret.trim() && (!info?.password || password.trim());

  const submit = () => {
    if (!valid) return;
    /* L'id est pose ici, au clic — jamais pendant le rendu. */
    onAdd({ id: crypto.randomUUID(), exchange, label: cleanLabel, apiKey: apiKey.trim(), secret: secret.trim(), password: password.trim(), testnet: !!info?.testnet && testnet });
  };

  return (
    <div className="xch-form">
      <Field id="xch-exchange" label="Exchange">
        <Select
          id="xch-exchange"
          label="Exchanges"
          value={exchange}
          options={EXCHANGES.map((e) => ({
            value: e.id,
            label: e.label,
            meta: [e.testnet ? "testnet disponible" : null, e.password ? "passphrase requise" : null].filter(Boolean).join(" · ") || undefined,
          }))}
          onChange={(id) => {
            setExchange(id);
            if (!exchangeInfo(id)?.testnet) setTestnet(false);
          }}
        />
      </Field>
      <Field id="xch-label" label="Nom du compte" hint={`Celui que l'agent emploiera : « ${suggested} ».`} error={duplicate ? "Un compte porte déjà ce nom." : undefined}>
        <input id="xch-label" className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={suggested} />
      </Field>
      <Field id="xch-key" label="Clé API">
        <div className="ob-key">
          <input id="xch-key" className="field-input mono" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <button type="button" className="ob-key-eye" onClick={() => setShown(!shown)} aria-label={shown ? "Masquer" : "Afficher"}>
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
        Réseau de test (testnet){info?.testnet ? "" : " — pas proposé par cet exchange"}
      </label>
      <div className="xch-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={!valid} onClick={submit}>
          Ajouter
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}
