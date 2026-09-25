"use client";

import { useEffect, useState, type ReactNode } from "react";
import { NEED_LABELS, PLUGIN_CATEGORIES, type ConfigProperty, type PluginManifest, type PluginsState, type PluginStatus } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { PLUGIN_MANIFESTS, pluginManifest, unmetNeeds } from "@/lib/plugins/catalog";
import { clearPluginData } from "@/lib/plugins/client";
import { requiredBy } from "@/lib/plugins/core/graph";
import { pluginSettings, resolveConfig, setPluginAgents, setPluginConfig, togglePlugin, validValue } from "@/lib/plugins/core/state";
import { describePolicy } from "@/lib/tools/policy";
import { refreshPlugins, usePlugins } from "@/lib/state/plugins";
import { closeViews, openView } from "@/lib/state/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ArrowLeft, ArrowRight, Search } from "@/components/ui/icons";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SettingsTab } from "./settings-panel";

/* ---------------------------------------------------------------------------
   The plugin library, in the settings.

   Only the plugins shipped with the app — no catalogue from elsewhere.
   The library shows them as blocks grouped by category, with a search;
   each block carries the prerequisites it needs, its state and its switch. A
   plugin's page says everything it does: what it is, the views it opens,
   the tools it gives the agents WITH WHAT EACH MAY DO WITHOUT YOU, whom it
   depends on and who depends on it, its settings, which agents may use
   it, and what it stores — with a way to clear it.

   Every change saves at once. Switching one off also switches off what
   requires it, switching one on what it requires: a confirmation lists
   them first. Shipped plugins switch off; they are never removed.
--------------------------------------------------------------------------- */

type Props = {
  settings: Settings;
  /** A plugin's page to open directly. */
  initial?: string;
  onUpdate: (patch: Partial<Settings>) => void;
  onGo: (tab: SettingsTab) => void;
};

type Pending = { id: string; on: boolean; state: PluginsState; also: string[] };

const nameOf = (id: string) => pluginManifest(id)?.name ?? id;
const names = (ids: string[]) => ids.map(nameOf).join(", ");

export function PluginsLibrary({ settings, initial, onUpdate, onGo }: Props) {
  const [selected, setSelected] = useState<string | null>(initial && pluginManifest(initial) ? initial : null);
  const [pending, setPending] = useState<Pending | null>(null);
  const { status } = usePlugins();

  useEffect(() => {
    void refreshPlugins();
  }, []);

  const apply = (p: Pending) => {
    onUpdate({ plugins: p.state });
    if (!p.on) closeViews([p.id, ...p.also].flatMap((id) => pluginManifest(id)?.views.map((v) => v.id) ?? []));
  };

  const toggle = (id: string, on: boolean) => {
    const { state, also } = togglePlugin(PLUGIN_MANIFESTS, settings.plugins, id, on);
    const next = { id, on, state, also };
    if (also.length) setPending(next);
    else apply(next);
  };

  const statusOf = (id: string): PluginStatus => status.find((s) => s.id === id) ?? { id, state: pluginSettings(settings.plugins, id).enabled ? "active" : "disabled" };
  const manifest = selected ? pluginManifest(selected) : undefined;

  return (
    <>
      {manifest ? (
        <PluginPage key={manifest.id} manifest={manifest} settings={settings} status={statusOf(manifest.id)} onBack={() => setSelected(null)} onToggle={toggle} onUpdate={onUpdate} onGo={onGo} />
      ) : (
        <PluginList settings={settings} statusOf={statusOf} onOpen={setSelected} onToggle={toggle} />
      )}
      {pending && (
        <ConfirmDialog
          title={pending.on ? `Switch on ${nameOf(pending.id)}?` : `Switch off ${nameOf(pending.id)}?`}
          body={
            pending.on
              ? `It needs ${names(pending.also)}, which will be switched on too.`
              : `${names(pending.also)} cannot run without it and will be switched off too. Their data is kept.`
          }
          confirmLabel={pending.on ? "Switch on" : "Switch off"}
          onConfirm={() => {
            apply(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

/* --- The library ------------------------------------------------------------

   A shelf of blocks, one per plugin, under its category. A block opens the
   plugin's page; its foot says whether it runs — on the left, green when
   active, red when off (and when it failed), amber while it waits for a
   plugin it needs — and holds its switch on the right. */

function StateTag({ on, status }: { on: boolean; status: PluginStatus }) {
  const [tone, label] = !on
    ? ["is-off", "Inactive"]
    : status.state === "error"
      ? ["is-off", "Error"]
      : status.state === "blocked"
        ? ["is-wait", "Waiting"]
        : ["is-on", "Active"];
  return (
    <span className={`pl-state ${tone}`} title={on && status.state !== "active" ? status.message : undefined}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

function PluginList({ settings, statusOf, onOpen, onToggle }: { settings: Settings; statusOf: (id: string) => PluginStatus; onOpen: (id: string) => void; onToggle: (id: string, on: boolean) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = PLUGIN_MANIFESTS.filter((m) => !q || `${m.name} ${m.summary} ${m.description}`.toLowerCase().includes(q));
  return (
    <>
      <h1 id="st-title" className="st-title">
        Plugins
      </h1>
      <p className="st-lede">Plugins give your agents tools, views and background work. The ones shipped with BytNode-AI can be switched off, never removed.</p>
      <label className="pl-search">
        <Search />
        <input type="search" placeholder="Search the plugins" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the plugins" />
      </label>
      {shown.length === 0 && <p className="st-empty">No plugin matches “{query}”.</p>}
      {PLUGIN_CATEGORIES.map((cat) => {
        const inCat = shown.filter((m) => m.category === cat.id);
        if (inCat.length === 0) return null;
        return (
          <section key={cat.id} className="st-section">
            <h2 className="st-section-title">
              {cat.label}
              <span className="pl-count">{inCat.length}</span>
            </h2>
            <ul className="pl-grid">
              {inCat.map((m) => {
                const on = pluginSettings(settings.plugins, m.id).enabled;
                const missing = unmetNeeds(settings, m);
                return (
                  <li key={m.id} className={`pl-card${on ? "" : " is-disabled"}`}>
                    <button type="button" className="pl-open" onClick={() => onOpen(m.id)}>
                      <span className="pl-name">
                        {m.name}
                        <ArrowRight />
                      </span>
                      <span className="pl-summary">{m.summary}</span>
                      {m.needs.length > 0 && (
                        <span className="pl-needs">
                          {m.needs.map((n) => (
                            <span key={n} className={`pl-need${missing.includes(n) ? " is-missing" : ""}`}>
                              {NEED_LABELS[n]}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                    <div className="pl-foot">
                      <StateTag on={on} status={statusOf(m.id)} />
                      <Switch on={on} onChange={(v) => onToggle(m.id, v)} label={`${on ? "Switch off" : "Switch on"} ${m.name}`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/* --- A plugin's page ------------------------------------------------------ */

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="st-section">
      <h2 className="st-section-title">{title}</h2>
      {children}
    </section>
  );
}

type PageProps = {
  manifest: PluginManifest;
  settings: Settings;
  status: PluginStatus;
  onBack: () => void;
  onToggle: (id: string, on: boolean) => void;
  onUpdate: (patch: Partial<Settings>) => void;
  onGo: (tab: SettingsTab) => void;
};

function PluginPage({ manifest: m, settings, status, onBack, onToggle, onUpdate, onGo }: PageProps) {
  const { tools } = usePlugins();
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const own = pluginSettings(settings.plugins, m.id);
  const config = resolveConfig(m, own.config);
  const users = requiredBy(PLUGIN_MANIFESTS, m.id);
  const missing = unmetNeeds(settings, m);
  const mine = tools.filter((t) => t.plugin === m.id);
  const set = (key: string, value: string | number | boolean) => onUpdate({ plugins: setPluginConfig(settings.plugins, m.id, key, value) });
  const setAgents = (ids: string[] | null) => onUpdate({ plugins: setPluginAgents(settings.plugins, m.id, ids) });
  const allowed = own.agentIds;

  return (
    <>
      <button type="button" className="st-back" onClick={onBack}>
        <ArrowLeft />
        Plugins
      </button>
      <div className="st-head">
        <h1 id="st-title" className="st-title">
          {m.name}
        </h1>
        <Switch on={own.enabled} onChange={(v) => onToggle(m.id, v)} label={`${own.enabled ? "Switch off" : "Switch on"} ${m.name}`} />
      </div>
      <p className="st-lede">{m.summary}</p>
      {status.state === "error" && (
        <div className="notice pl-notice" role="alert">
          <p>It could not start: {status.message}</p>
        </div>
      )}
      {status.state === "blocked" && (
        <div className="notice pl-notice">
          <p>{status.message}</p>
        </div>
      )}
      {own.enabled && missing.length > 0 && (
        <div className="notice pl-notice">
          <p>{missing.map((n) => NEED_LABELS[n]).join(" · ")}: until then, no agent receives its tools.</p>
          <button type="button" className="btn btn-sm" onClick={() => onGo("auth")}>
            Open Auth
          </button>
        </div>
      )}

      <Block title="Presentation">
        <p className="pl-text">{m.description}</p>
        {m.views.map((v) => (
          <div key={v.id} className="st-row">
            <div className="st-row-text">
              <span className="st-row-label">{v.title}</span>
              <p className="st-row-hint">{v.description}</p>
            </div>
            <div className="st-row-control pl-right">
              <button type="button" className="btn btn-sm" onClick={() => openView(v.id)} disabled={!own.enabled}>
                Open the view
                <ArrowRight />
              </button>
            </div>
          </div>
        ))}
      </Block>

      <Block title="Tools given to the agents">
        {mine.length === 0 ? (
          <p className="pl-text pl-muted">{status.state === "active" ? "No tool: it works in the background or through its views." : "Its tools are listed once it runs."}</p>
        ) : (
          <ul className="pl-tools">
            {mine.map((t) => (
              <li key={t.name}>
                <span className="pl-tool mono">{t.name}</span>
                <span className={`pl-policy${t.policy.alwaysAsk ? " is-strong" : ""}`}>{describePolicy(t.policy)}</span>
                <span className="pl-tool-desc">{t.description.split(/(?<=\.)\s/)[0]}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Dependencies">
        <p className="pl-text">
          {m.requires.length ? `Needs ${names(m.requires)}.` : "Needs no other plugin."}
          {m.optional.length ? ` Uses ${names(m.optional)} when they run.` : ""}
          {users.length ? ` ${names(users)} cannot run without it.` : ""}
        </p>
        {m.needs.length > 0 && <p className="pl-text">Prerequisites: {m.needs.map((n) => NEED_LABELS[n].toLowerCase()).join(", ")}.</p>}
      </Block>

      {Object.keys(m.config.properties).length > 0 && (
        <Block title="Settings">
          {Object.entries(m.config.properties).map(([key, prop]) => (
            <ConfigField key={key} id={`pl-${m.id}-${key}`} prop={prop} value={config[key]} stored={own.config[key]} settings={settings} onChange={(v) => set(key, v)} />
          ))}
        </Block>
      )}

      <Block title="Agents allowed">
        <div className="st-seg pl-seg" role="radiogroup" aria-label="Agents allowed">
          <button type="button" role="radio" aria-checked={allowed === null} className={`st-seg-btn${allowed === null ? " is-on" : ""}`} onClick={() => setAgents(null)}>
            Every agent
          </button>
          <button type="button" role="radio" aria-checked={allowed !== null} className={`st-seg-btn${allowed !== null ? " is-on" : ""}`} onClick={() => setAgents(allowed ?? settings.agents.map((a) => a.id))}>
            Only some
          </button>
        </div>
        {allowed !== null && (
          <div className="xch-pick pl-agents">
            {settings.agents.map((a) => (
              <label key={a.id}>
                <input type="checkbox" checked={allowed.includes(a.id)} onChange={() => setAgents(allowed.includes(a.id) ? allowed.filter((x) => x !== a.id) : [...allowed, a.id])} />
                <span>{a.name || "Unnamed"}</span>
              </label>
            ))}
          </div>
        )}
      </Block>

      <Block title="Data">
        {m.data === null ? (
          <p className="pl-text pl-muted">It stores nothing.</p>
        ) : (
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-label">What it stores</span>
              <p className="st-row-hint">{m.data} In ~/.bytnode-ai/plugins/{m.id}/.</p>
              {cleared && <p className="st-row-hint">{cleared}</p>}
            </div>
            <div className="st-row-control pl-right">
              <button type="button" className="btn btn-sm" onClick={() => setClearing(true)}>
                Clear the data
              </button>
            </div>
          </div>
        )}
      </Block>

      {clearing && m.data !== null && (
        <ConfirmDialog
          title={`Clear the data of ${m.name}?`}
          body={`${m.data} Everything it stored is deleted. This cannot be undone.`}
          confirmLabel="Clear"
          onConfirm={() => {
            setClearing(false);
            clearPluginData(m.id).then(
              () => setCleared("Cleared."),
              (e: Error) => setCleared(`Could not clear: ${e.message}`),
            );
          }}
          onCancel={() => setClearing(false)}
        />
      )}
    </>
  );
}

/* --- A setting, generated from the plugin's schema ---------------------- */

type FieldProps = { id: string; prop: ConfigProperty; value: string | number | boolean; stored: unknown; settings: Settings; onChange: (v: string | number | boolean) => void };

function ConfigField({ id, prop, value, stored, settings, onChange }: FieldProps) {
  /* What the user typed, even if not valid yet: the runtime uses the
     default until it is. */
  const [draft, setDraft] = useState(stored === undefined ? String(value) : String(stored));
  const invalid = stored !== undefined && !validValue(prop, stored);
  let control: ReactNode;
  if (prop.type === "boolean") {
    control = <Switch on={value === true} onChange={onChange} label={prop.title} />;
  } else if (prop.enum) {
    control = <Select id={id} value={String(value)} label={prop.title} options={prop.enum.map((v, i) => ({ value: String(v), label: prop.enumLabels?.[i] ?? String(v) }))} onChange={(v) => onChange(prop.type === "string" ? v : Number(v))} />;
  } else if (prop.format === "agent") {
    control = (
      <Select
        id={id}
        value={String(value)}
        label={prop.title}
        placeholder="The first agent"
        options={[{ value: "", label: "The first agent" }, ...settings.agents.map((a) => ({ value: a.id, label: a.name || "Unnamed" }))]}
        onChange={onChange}
      />
    );
  } else {
    const numeric = prop.type === "number" || prop.type === "integer";
    control = (
      <input
        id={id}
        className="field-input"
        type={numeric ? "number" : prop.format === "time" ? "time" : "text"}
        step={prop.type === "integer" ? 1 : "any"}
        min={prop.minimum}
        max={prop.maximum}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (numeric) {
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
          } else onChange(e.target.value);
        }}
      />
    );
  }
  return (
    <div className="st-row">
      <div className="st-row-text">
        <label className="st-row-label" htmlFor={id}>
          {prop.title}
        </label>
        {prop.description && <p className="st-row-hint">{prop.description}</p>}
        {invalid && <p className="field-error">Not valid: the default ({String(prop.default)}) applies until it is.</p>}
      </div>
      <div className="st-row-control">{control}</div>
    </div>
  );
}
