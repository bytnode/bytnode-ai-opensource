"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PLUGIN_CATEGORIES, type ConfigProperty, type PluginManifest, type PluginNeed, type PluginsState, type PluginStatus } from "@/lib/domain/plugins";
import type { Settings } from "@/lib/domain/types";
import { PLUGIN_MANIFESTS, pluginManifest, unmetNeeds } from "@/lib/plugins/catalog";
import { clearPluginData, decideUserPlugin, deleteUserPlugin, revokeUserPlugin } from "@/lib/plugins/client";
import { describePermissions, type PermissionLine, type Permissions } from "@/lib/plugins/user/permissions";
import type { UserPluginInfo } from "@/lib/plugins/user/types";
import { openReview, refreshUserPlugins, runningManifests, useUserPlugins } from "@/lib/state/user-plugins";
import { pluginSettings, resolveConfig, setPluginAgents, setPluginConfig, validValue } from "@/lib/plugins/core/state";
import type { ToolPolicy } from "@/lib/tools/types";
import { refreshPlugins, usePlugins } from "@/lib/state/plugins";
import { closeViews, openView } from "@/lib/state/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ArrowLeft, ArrowRight, Search } from "@/components/ui/icons";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMessages } from "@/lib/i18n/react";
import { categoryLabel, configText, pluginText, viewText } from "@/lib/i18n/plugin-text";
import { dateTag } from "@/lib/i18n/store";
import type { Messages } from "@/lib/i18n/messages/en";
import type { SettingsTab } from "./settings-panel";

/* ---------------------------------------------------------------------------
   The plugin library, in the settings.

   Only the plugins shipped with the app — no catalogue from elsewhere.
   The library shows them as blocks grouped by category, with a search;
   each block carries the prerequisites it needs, its state and its switch. A
   plugin's page says everything it does: what it is, the views it opens,
   the tools it gives the agents WITH WHAT EACH MAY DO WITHOUT YOU, the
   plugins it works better with, its settings, which agents may use it,
   and what it stores — with a way to clear it.

   Every change saves at once. Every plugin is independent: switching one
   on or off touches no other (no cascade, no confirmation). Shipped
   plugins switch off; they are never removed.

   Below them, the plugins the user's agents WROTE (`lib/plugins/user/`):
   the same blocks, plus their state in the review (draft, waiting for
   the user, active), and on their page what they were granted, their
   recent problems, and the way to review, revoke or delete them.
--------------------------------------------------------------------------- */

type Props = {
  settings: Settings;
  /** A plugin's page to open directly. */
  initial?: string;
  onUpdate: (patch: Partial<Settings>) => void;
  onGo: (tab: SettingsTab) => void;
};

/* What `lib/` words in English for the agents (`NEED_LABELS`,
   `describePolicy`, `describePermissions`), said here in the interface's
   language. */
const needLabel = (n: PluginNeed, m: Messages): string => m.settings.plugins.needs[n];

function policyText(p: ToolPolicy, m: Messages): string {
  const t = m.settings.plugins.policy;
  const what = p.alwaysAsk ? t.alwaysAsk : p.gated ? t.gated : p.readOnly ? t.readOnly : t.runs;
  return p.subagent ? t.subagent(what) : what;
}

function permissionText(l: PermissionLine, p: Permissions, m: Messages): string {
  const t = m.settings.plugins.permissions;
  if (l.key === "network") return t.network(p.network.join(", "));
  if (l.key === "exchange") return p.exchange === "orders" ? t.exchangeOrders : t.exchangeRead;
  if (l.key === "bytnode") return t.bytnode;
  if (l.key === "schedule") return t.schedule;
  if (l.key === "notify") return t.notify;
  return l.text;
}

export function PluginsLibrary({ settings, initial, onUpdate, onGo }: Props) {
  const m = useMessages();
  const mine = useUserPlugins();
  const extra = runningManifests(mine);
  const nameOf = (id: string) => {
    const manifest = pluginManifest(id, extra);
    return manifest ? pluginText(manifest, m).name : id;
  };
  const names = (ids: string[]) => ids.map(nameOf).join(", ");
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const { status } = usePlugins();

  useEffect(() => {
    void refreshPlugins();
    void refreshUserPlugins();
  }, []);

  /* This plugin only: no other one depends on it. */
  const toggle = (id: string, on: boolean) => {
    const state: PluginsState = { ...settings.plugins, [id]: { ...pluginSettings(settings.plugins, id), enabled: on } };
    onUpdate({ plugins: state });
    if (!on) closeViews(pluginManifest(id, extra)?.views.map((v) => v.id) ?? []);
  };

  const statusOf = (id: string): PluginStatus => status.find((s) => s.id === id) ?? { id, state: pluginSettings(settings.plugins, id).enabled ? "active" : "disabled" };
  const user = selected ? mine.find((p) => p.id === selected) : undefined;
  const manifest = selected ? (pluginManifest(selected) ?? user?.manifest ?? undefined) : undefined;

  return (
    <>
      {manifest ? (
        <PluginPage key={manifest.id} manifest={manifest} user={user} settings={settings} status={statusOf(manifest.id)} names={names} onBack={() => setSelected(null)} onToggle={toggle} onUpdate={onUpdate} onGo={onGo} />
      ) : (
        <PluginList settings={settings} mine={mine} statusOf={statusOf} onOpen={setSelected} onToggle={toggle} />
      )}
    </>
  );
}

/* --- The library ------------------------------------------------------------

   A shelf of blocks, one per plugin, under its category. A block opens the
   plugin's page; its foot says whether it runs — on the left, green when
   active, red when off (and when it failed) — and holds its switch on the
   right. */

function StateTag({ on, status }: { on: boolean; status: PluginStatus }) {
  const t = useMessages().settings.plugins;
  const [tone, label] = !on
    ? ["is-off", t.inactive]
    : status.state === "error"
      ? ["is-off", t.error]
      : ["is-on", t.active];
  return (
    <span className={`pl-state ${tone}`} title={on && status.state !== "active" ? status.message : undefined}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

type ListProps = { settings: Settings; mine: UserPluginInfo[]; statusOf: (id: string) => PluginStatus; onOpen: (id: string) => void; onToggle: (id: string, on: boolean) => void };

function PluginList({ settings, mine, statusOf, onOpen, onToggle }: ListProps) {
  const msg = useMessages();
  const t = msg.settings.plugins;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  /* Searched in the words shown, and in the English ones (a name typed as
     the agents say it). */
  const shown = PLUGIN_MANIFESTS.filter((m) => {
    if (!q) return true;
    const w = pluginText(m, msg);
    return `${w.name} ${w.summary} ${w.description} ${m.name} ${m.summary}`.toLowerCase().includes(q);
  });
  const written = mine.filter((p) => !q || `${p.name} ${p.summary}`.toLowerCase().includes(q));
  return (
    <>
      <h1 id="st-title" className="st-title">
        {msg.settings.tabs.plugins}
      </h1>
      <p className="st-lede">{t.lede}</p>
      <label className="pl-search">
        <Search />
        <input type="search" placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t.search} />
      </label>
      {shown.length === 0 && written.length === 0 && <p className="st-empty">{t.noMatch(query)}</p>}
      {PLUGIN_CATEGORIES.map((cat) => {
        const inCat = shown.filter((m) => m.category === cat.id);
        if (inCat.length === 0) return null;
        return (
          <section key={cat.id} className="st-section">
            <h2 className="st-section-title">
              {categoryLabel(cat.id, msg)}
              <span className="pl-count">{inCat.length}</span>
            </h2>
            <ul className="pl-grid">
              {inCat.map((m) => {
                const on = pluginSettings(settings.plugins, m.id).enabled;
                const missing = unmetNeeds(settings, m);
                const w = pluginText(m, msg);
                return (
                  <li key={m.id} className={`pl-card${on ? "" : " is-disabled"}`}>
                    <button type="button" className="pl-open" onClick={() => onOpen(m.id)}>
                      <span className="pl-name">
                        {w.name}
                        <ArrowRight />
                      </span>
                      <span className="pl-summary">{w.summary}</span>
                      {m.needs.length > 0 && (
                        <span className="pl-needs">
                          {m.needs.map((n) => (
                            <span key={n} className={`pl-need${missing.includes(n) ? " is-missing" : ""}`}>
                              {needLabel(n, msg)}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                    <div className="pl-foot">
                      <StateTag on={on} status={statusOf(m.id)} />
                      <Switch on={on} onChange={(v) => onToggle(m.id, v)} label={on ? t.switchOff(w.name) : t.switchOn(w.name)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {written.length > 0 && (
        <section className="st-section">
          <h2 className="st-section-title">
            {t.writtenByAgents}
            <span className="pl-count">{written.length}</span>
          </h2>
          <ul className="pl-grid">
            {written.map((p) => {
              const on = pluginSettings(settings.plugins, p.id).enabled;
              return (
                <li key={p.id} className={`pl-card${p.state === "active" && on ? "" : " is-disabled"}`}>
                  <button type="button" className="pl-open" onClick={() => onOpen(p.id)}>
                    <span className="pl-name">
                      {p.name}
                      <ArrowRight />
                    </span>
                    <span className="pl-summary">{p.summary || t.notDescribed}</span>
                  </button>
                  <div className="pl-foot">
                    {p.state === "pending" ? (
                      <>
                        <span className="pl-state is-wait">
                          <i aria-hidden="true" />
                          {t.waitingReview}
                        </span>
                        <button type="button" className="btn btn-sm" onClick={() => openReview(p.id)}>
                          {t.review}
                        </button>
                      </>
                    ) : p.state === "draft" ? (
                      <span className="pl-state is-off">
                        <i aria-hidden="true" />
                        {t.draft}
                      </span>
                    ) : (
                      <>
                        <StateTag on={on} status={p.state === "error" ? { id: p.id, state: "error", message: p.message } : statusOf(p.id)} />
                        <Switch on={on} onChange={(v) => onToggle(p.id, v)} label={on ? t.switchOff(p.name) : t.switchOn(p.name)} />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
  /** Set when an agent wrote it. */
  user?: UserPluginInfo;
  settings: Settings;
  status: PluginStatus;
  names: (ids: string[]) => string;
  onBack: () => void;
  onToggle: (id: string, on: boolean) => void;
  onUpdate: (patch: Partial<Settings>) => void;
  onGo: (tab: SettingsTab) => void;
};

function PluginPage({ manifest: m, user, settings, status, names, onBack, onToggle, onUpdate, onGo }: PageProps) {
  const msg = useMessages();
  const t = msg.settings.plugins;
  /* A shipped plugin's words in the interface's language; one an agent
     wrote keeps its own. */
  const w = pluginText(m, msg);
  const { tools } = usePlugins();
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<string | null>(null);
  const [removing, setRemoving] = useState<"revoke" | "delete" | null>(null);
  /* A plugin written by an agent runs only once the user granted it. */
  const runs = !user || Boolean(user.granted);
  const own = pluginSettings(settings.plugins, m.id);
  const config = resolveConfig(m, own.config);
  const missing = unmetNeeds(settings, m);
  const mine = tools.filter((t) => t.plugin === m.id);
  const set = (key: string, value: string | number | boolean) => onUpdate({ plugins: setPluginConfig(settings.plugins, m.id, key, value) });
  const setAgents = (ids: string[] | null) => onUpdate({ plugins: setPluginAgents(settings.plugins, m.id, ids) });
  const allowed = own.agentIds;

  return (
    <>
      <button type="button" className="st-back" onClick={onBack}>
        <ArrowLeft />
        {msg.settings.tabs.plugins}
      </button>
      <div className="st-head">
        <h1 id="st-title" className="st-title">
          {w.name}
        </h1>
        {runs && <Switch on={own.enabled} onChange={(v) => onToggle(m.id, v)} label={own.enabled ? t.switchOff(w.name) : t.switchOn(w.name)} />}
      </div>
      <p className="st-lede">{w.summary}</p>
      {user && <UserPluginBlock user={user} settings={settings} onRemove={setRemoving} />}
      {status.state === "error" && !user?.message && (
        <div className="notice pl-notice" role="alert">
          <p>{t.couldNotStart(status.message ?? "")}</p>
        </div>
      )}
      {own.enabled && missing.length > 0 && (
        <div className="notice pl-notice">
          <p>{t.needsMissing(missing.map((n) => needLabel(n, msg)).join(" · "))}</p>
          <button type="button" className="btn btn-sm" onClick={() => onGo("auth")}>
            {t.openAuth}
          </button>
        </div>
      )}

      <Block title={t.presentation}>
        <p className="pl-text">{w.description}</p>
        {m.views.map((v) => (
          <div key={v.id} className="st-row">
            <div className="st-row-text">
              <span className="st-row-label">{viewText(m.id, v, msg).title}</span>
              <p className="st-row-hint">{viewText(m.id, v, msg).description}</p>
            </div>
            <div className="st-row-control pl-right">
              <button type="button" className="btn btn-sm" onClick={() => openView(v.id)} disabled={!own.enabled || !runs}>
                {t.openView}
                <ArrowRight />
              </button>
            </div>
          </div>
        ))}
      </Block>

      <Block title={t.tools}>
        {mine.length === 0 ? (
          <p className="pl-text pl-muted">{status.state === "active" ? t.noTool : t.toolsLater}</p>
        ) : (
          <ul className="pl-tools">
            {mine.map((tool) => (
              <li key={tool.name}>
                <span className="pl-tool mono">{tool.name}</span>
                <span className={`pl-policy${tool.policy.alwaysAsk ? " is-strong" : ""}`}>{policyText(tool.policy, msg)}</span>
                <span className="pl-tool-desc">{tool.description.split(/(?<=\.)\s/)[0]}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t.dependencies}>
        <p className="pl-text">{t.independent(m.optional.length ? names(m.optional) : "")}</p>
        {m.needs.length > 0 && <p className="pl-text">{t.prerequisites(m.needs.map((n) => needLabel(n, msg).toLowerCase()).join(", "))}</p>}
      </Block>

      {Object.keys(m.config.properties).length > 0 && (
        <Block title={t.settings}>
          {Object.entries(m.config.properties).map(([key, prop]) => (
            <ConfigField key={key} id={`pl-${m.id}-${key}`} pluginId={m.id} fieldKey={key} prop={prop} value={config[key]} stored={own.config[key]} settings={settings} onChange={(v) => set(key, v)} />
          ))}
        </Block>
      )}

      <Block title={t.agentsAllowed}>
        <div className="st-seg pl-seg" role="radiogroup" aria-label={t.agentsAllowed}>
          <button type="button" role="radio" aria-checked={allowed === null} className={`st-seg-btn${allowed === null ? " is-on" : ""}`} onClick={() => setAgents(null)}>
            {t.everyAgent}
          </button>
          <button type="button" role="radio" aria-checked={allowed !== null} className={`st-seg-btn${allowed !== null ? " is-on" : ""}`} onClick={() => setAgents(allowed ?? settings.agents.map((a) => a.id))}>
            {t.onlySome}
          </button>
        </div>
        {allowed !== null && (
          <div className="xch-pick pl-agents">
            {settings.agents.map((a) => (
              <label key={a.id}>
                <input type="checkbox" checked={allowed.includes(a.id)} onChange={() => setAgents(allowed.includes(a.id) ? allowed.filter((x) => x !== a.id) : [...allowed, a.id])} />
                <span>{a.name || msg.settings.agents.unnamed}</span>
              </label>
            ))}
          </div>
        )}
      </Block>

      <Block title={t.data}>
        {w.data === null ? (
          <p className="pl-text pl-muted">{t.storesNothing}</p>
        ) : (
          <div className="st-row">
            <div className="st-row-text">
              <span className="st-row-label">{t.whatItStores}</span>
              <p className="st-row-hint">
                {t.storedIn(w.data, `~/.bytnode-ai/${m.tier === "user" ? `bytnode-plugin-user/${m.id}/data` : `plugins/${m.id}`}/`)}
              </p>
              {cleared && <p className="st-row-hint">{cleared}</p>}
            </div>
            <div className="st-row-control pl-right">
              <button type="button" className="btn btn-sm" onClick={() => setClearing(true)}>
                {t.clearData}
              </button>
            </div>
          </div>
        )}
      </Block>

      {removing && user && (
        <ConfirmDialog
          title={removing === "revoke" ? t.revokeTitle(w.name) : t.deleteTitle(w.name)}
          body={
            removing === "revoke"
              ? t.revokeBody
              : t.deleteBody
          }
          confirmLabel={removing === "revoke" ? t.revoke : msg.common.delete}
          onConfirm={() => {
            const what = removing;
            setRemoving(null);
            (what === "revoke" ? revokeUserPlugin(m.id) : deleteUserPlugin(m.id, true)).then(
              () => {
                closeViews(m.views.map((v) => v.id));
                void refreshUserPlugins();
                void refreshPlugins();
                if (what === "delete") onBack();
              },
              (e: Error) => setCleared(what === "revoke" ? t.couldNotRevoke(e.message) : t.couldNotDelete(e.message)),
            );
          }}
          onCancel={() => setRemoving(null)}
        />
      )}

      {clearing && w.data !== null && (
        <ConfirmDialog
          title={t.clearTitle(w.name)}
          body={t.clearBody(w.data)}
          confirmLabel={t.clear}
          onConfirm={() => {
            setClearing(false);
            clearPluginData(m.id).then(
              () => setCleared(t.cleared),
              (e: Error) => setCleared(t.couldNotClear(e.message)),
            );
          }}
          onCancel={() => setClearing(false)}
        />
      )}
    </>
  );
}

/* --- What only a plugin written by an agent has ---------------------------

   Who wrote it, what it waits for, what it was granted (and on which
   accounts), what went wrong lately in its code or its page, and the ways
   out: revoke (it stops, the draft stays) and delete. */

/** A grant from before approvals were signed: the user approves the same
    permissions again, from this tab (the approval key is this browser's). */
function ApproveAgain({ user }: { user: UserPluginInfo }) {
  const t = useMessages().settings.plugins;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const again = () => {
    if (!user.unsigned) return;
    setBusy(true);
    setError("");
    decideUserPlugin(user.id, user.unsigned.digest, true, user.granted?.accounts ?? [])
      .then(() => refreshUserPlugins())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="notice pl-notice" role="alert">
      <p>{t.approveAgainText}</p>
      <button type="button" className="btn btn-sm" onClick={again} disabled={busy}>
        {t.approveAgain}
      </button>
      {error && <p>{error}</p>}
    </div>
  );
}

function UserPluginBlock({ user, settings, onRemove }: { user: UserPluginInfo; settings: Settings; onRemove: (what: "revoke" | "delete") => void }) {
  const m = useMessages();
  const t = m.settings.plugins;
  const agent = (id: string) => settings.agents.find((a) => a.id === id)?.name || t.anAgent;
  const granted = user.granted ? describePermissions(user.granted.permissions, m) : [];
  const accounts = user.granted?.accounts.map((id) => settings.keys.exchanges.find((a) => a.id === id)?.label ?? t.goneAccount) ?? [];
  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(dateTag(), { day: "numeric", month: "short", year: "numeric" }) : "");
  return (
    <>
      {user.state === "pending" && (
        <div className="notice pl-notice">
          <p>{user.granted ? t.updateWaits : t.waitsReview}</p>
          <button type="button" className="btn btn-sm" onClick={() => openReview(user.id)}>
            {t.review}
          </button>
        </div>
      )}
      {user.unsigned ? (
        <ApproveAgain user={user} />
      ) : (
        user.state === "error" &&
        user.message && (
          <div className="notice pl-notice" role="alert">
            <p>{t.couldNotStart(user.message)}</p>
          </div>
        )
      )}
      <Block title={t.writtenByAgent}>
        <p className="pl-text">
          {t.authorship(
            agent(user.createdBy),
            when(user.createdAt),
            user.updatedAt && user.updatedAt !== user.createdAt ? agent(user.updatedBy) : null,
            when(user.updatedAt),
          )}
        </p>
        {user.granted ? (
          <ul className="pl-tools">
            {granted.length === 0 ? (
              <li>
                <span className="pl-tool-desc">{t.grantedNothing}</span>
              </li>
            ) : (
              granted.map((l) => (
                <li key={l.key}>
                  <span className={`pl-policy${l.danger ? " is-strong" : ""}`}>{user.granted ? permissionText(l, user.granted.permissions, m) : l.text}</span>
                  {l.key === "exchange" && accounts.length > 0 && <span className="pl-tool-desc">{accounts.join(", ")}</span>}
                </li>
              ))
            )}
          </ul>
        ) : (
          <p className="pl-text pl-muted">{t.neverRan}</p>
        )}
        {user.log.length > 0 && (
          <>
            <p className="pl-text">{t.recentProblems}</p>
            <ul className="pl-tools">
              {user.log
                .slice(-5)
                .reverse()
                .map((l) => (
                  <li key={`${l.at}${l.message}`}>
                    <span className="pl-tool mono">{l.source}</span>
                    <span className="pl-tool-desc">{l.message}</span>
                  </li>
                ))}
            </ul>
          </>
        )}
        <div className="pl-user-actions">
          {user.granted && (
            <button type="button" className="btn btn-sm" onClick={() => onRemove("revoke")}>
              {t.revoke}
            </button>
          )}
          <button type="button" className="btn btn-sm pl-delete" onClick={() => onRemove("delete")}>
            {m.common.delete}
          </button>
        </div>
      </Block>
    </>
  );
}

/* --- A setting, generated from the plugin's schema ---------------------- */

type FieldProps = { id: string; pluginId: string; fieldKey: string; prop: ConfigProperty; value: string | number | boolean; stored: unknown; settings: Settings; onChange: (v: string | number | boolean) => void };

function ConfigField({ id, pluginId, fieldKey, prop, value, stored, settings, onChange }: FieldProps) {
  const m = useMessages();
  const t = m.settings.plugins;
  /* The setting's label, help and choices in the interface's language. */
  const words = configText(pluginId, fieldKey, prop, m);
  /* What the user typed, even if not valid yet: the runtime uses the
     default until it is. */
  const [draft, setDraft] = useState(stored === undefined ? String(value) : String(stored));
  const invalid = stored !== undefined && !validValue(prop, stored);
  let control: ReactNode;
  if (prop.type === "boolean") {
    control = <Switch on={value === true} onChange={onChange} label={words.title} />;
  } else if (prop.enum) {
    control = <Select id={id} value={String(value)} label={words.title} options={prop.enum.map((v, i) => ({ value: String(v), label: words.enumLabels?.[i] ?? String(v) }))} onChange={(v) => onChange(prop.type === "string" ? v : Number(v))} />;
  } else if (prop.format === "agent") {
    control = (
      <Select
        id={id}
        value={String(value)}
        label={words.title}
        placeholder={t.firstAgent}
        options={[{ value: "", label: t.firstAgent }, ...settings.agents.map((a) => ({ value: a.id, label: a.name || m.settings.agents.unnamed }))]}
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
          {words.title}
        </label>
        {words.description && <p className="st-row-hint">{words.description}</p>}
        {invalid && <p className="field-error">{t.invalid(String(prop.default))}</p>}
      </div>
      <div className="st-row-control">{control}</div>
    </div>
  );
}
