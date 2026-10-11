"use client";

import { useMemo } from "react";
import type { Settings } from "@/lib/domain/types";
import { PLUGIN_MANIFESTS, pluginManifest } from "@/lib/plugins/catalog";
import { enabledPlugins } from "@/lib/plugins/core/state";
import { updateWidgets, useWidgets } from "@/lib/state/widgets";
import { SIZES, WIDGETS, widgetOn, type WidgetKind } from "@/lib/widgets/catalog";
import { TabIcon } from "@/components/shell/tab-icons";
import { Switch } from "@/components/ui/switch";
import { useMessages } from "@/lib/i18n/react";
import { pluginText } from "@/lib/i18n/plugin-text";
import type { SettingsTab } from "./settings-panel";

/* ---------------------------------------------------------------------------
   The widgets, in the settings (user request): under the plugins, the
   same blocks as the plugin library — each widget, what it shows, its
   sizes, how many stand on the page, and a switch. A widget switched off is
   neither drawn nor offered in the gallery; the ones placed keep their
   place and come back when it is switched on again. A widget whose plugin
   is off says so (its plugin's switch is in Plugins). Above them, the same
   Shown / Hidden as the header's menu. Saved at once, like every setting.
--------------------------------------------------------------------------- */

export function WidgetsSettings({ settings, onGo }: { settings: Settings; onGo: (tab: SettingsTab) => void }) {
  const m = useMessages();
  const t = m.settings.widgets;
  const state = useWidgets();
  const running = useMemo(() => new Set(enabledPlugins(PLUGIN_MANIFESTS, settings.plugins)), [settings.plugins]);
  const toggle = (kind: WidgetKind, on: boolean) =>
    updateWidgets((s) => {
      const off = (s.off ?? []).filter((k) => k !== kind);
      return { ...s, off: on ? off : [...off, kind] };
    });
  return (
    <>
      <h1 id="st-title" className="st-title">
        {m.settings.tabs.widgets}
      </h1>
      <p className="st-lede">{t.lede}</p>
      <section className="st-section">
        <h2 className="st-section-title">{t.display}</h2>
        <div className="st-row">
          <div className="st-row-text">
            <span className="st-row-label">{t.label}</span>
            <p className="st-row-hint">{t.hint}</p>
          </div>
          <div className="st-row-control">
            <div className="st-seg" role="radiogroup" aria-label={t.label}>
              <button type="button" role="radio" aria-checked={state.open} className={`st-seg-btn${state.open ? " is-on" : ""}`} onClick={() => updateWidgets((s) => ({ ...s, open: true }))}>
                {m.common.shown}
              </button>
              <button type="button" role="radio" aria-checked={!state.open} className={`st-seg-btn${!state.open ? " is-on" : ""}`} onClick={() => updateWidgets((s) => ({ ...s, open: false }))}>
                {m.common.hidden}
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="st-section">
        <h2 className="st-section-title">
          {t.label}
          <span className="pl-count">{WIDGETS.length}</span>
        </h2>
        <ul className="pl-grid">
          {WIDGETS.map((w) => {
            const on = widgetOn(state, w.kind);
            const plugin = running.has(w.plugin);
            const placed = state.items.filter((x) => x.kind === w.kind).length;
            const words = m.widgets.kinds[w.kind];
            const manifest = pluginManifest(w.plugin);
            return (
              <li key={w.kind} className={`pl-card wgs-card${on && plugin ? "" : " is-disabled"}`}>
                <div className="pl-open">
                  <span className="pl-name wgs-name">
                    <TabIcon view={w.view ?? "position-calc"} />
                    {words.name}
                  </span>
                  <span className="pl-summary">{words.description}</span>
                  <span className="pl-needs">
                    {SIZES.filter((s) => w.sizes.includes(s)).map((s) => (
                      <span key={s} className="pl-need">
                        {m.widgets.sizes[s]}
                      </span>
                    ))}
                    {placed > 0 && <span className="pl-need">{t.placed(placed)}</span>}
                  </span>
                </div>
                <div className="pl-foot">
                  {!plugin ? (
                    <button type="button" className="pl-state is-off wgs-plugin" onClick={() => onGo("plugins")} title={t.switchItOn}>
                      <i aria-hidden="true" />
                      {t.pluginOff(manifest ? pluginText(manifest, m).name : w.plugin)}
                    </button>
                  ) : (
                    <span className={`pl-state ${on ? "is-on" : "is-off"}`}>
                      <i aria-hidden="true" />
                      {on ? m.common.on : m.common.off}
                    </span>
                  )}
                  <Switch on={on} onChange={(v) => toggle(w.kind, v)} label={on ? t.switchOff(words.name) : t.switchOn(words.name)} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
