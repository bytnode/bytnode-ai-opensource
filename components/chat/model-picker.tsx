"use client";

import { useRef, useState } from "react";
import { EFFORT_OFF, effortLabel, effortOptions, latestModels, searchModels } from "@/lib/catalog/catalog";
import { loadCatalog, useCatalog } from "@/lib/catalog/use-catalog";
import type { Model } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";
import { Check, ChevronLeft, ChevronRight, Search } from "@/components/ui/icons";
import { ComposerPopover } from "./composer-popover";
import { useMessages } from "@/lib/i18n/react";
import { currentMessages } from "@/lib/i18n/store";

type Option = { value: string; name: string; description?: string | null };

type Props = {
  providerId: string;
  modelId: string | null;
  effort: string | null;
  onModel: (modelId: string) => void;
  onEffort: (effort: string | null) => void;
  /** The current mode and the ones that can be chosen: the external agent's
      modes (subscriptions) or our two permission modes. */
  mode: string | null;
  modeOptions: Option[];
  onMode: (mode: string) => void;
  /** The agent's profession: changes its prompt and its skills. */
  profession: string;
  professionOptions: Option[];
  onProfession: (profession: string) => void;
  disabled?: boolean;
  /** Open or not: the composer holds it, so typing can close it. */
  open: boolean;
  onOpenChange: (open: boolean, refocus?: boolean) => void;
};

/* A model's short name: OpenRouter prefixes the vendor's name
   ("Anthropic: Claude Sonnet 4"), and a subscription agent adds a note in
   brackets ("Opus (1M context)", "Default (recommended)") — noise in a chip
   or a value. The note is kept for the list's second line, where it tells
   two "Opus" apart. A subscription agent's "Default" is the app's word,
   in the interface's language. */
export const shortName = (m: Model) => {
  const short =
    m.name
      .replace(/^[^:]+:\s*/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim() || m.name;
  return short === "Default" ? currentMessages().chat.picker.default : short;
};

const noteOf = (m: Model) => m.name.match(/\(([^)]*)\)\s*$/)?.[1] ?? null;

const fmtContext = (n: number | null) => (n === null ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);

type View = "menu" | "model" | "effort" | "mode" | "profession";

/* The up-and-down chevron of a pop-up button, as on macOS. */
const UpDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden className="cmp-updown">
    <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />
  </svg>
);

/* ---------------------------------------------------------------------------
   The conversation's settings, in the composer.

   Closed: a glass chip — the model, the effort after a dot when one is set,
   and a pop-up chevron. Open: a settings pane as on macOS — four rows, the
   name on the left, the value on the right, a chevron — each opening its
   own page with a back button. The model: the provider's latest releases
   and a search over all the others, the context window beside each. The
   effort: the levels THIS model accepts (OpenRouter's list); a model that
   does not reason has no effort, and the row says so instead of vanishing.
--------------------------------------------------------------------------- */
export function ModelPicker({
  providerId,
  modelId,
  effort,
  mode,
  modeOptions,
  profession,
  professionOptions,
  onModel,
  onEffort,
  onMode,
  onProfession,
  disabled,
  open,
  onOpenChange,
}: Props) {
  const m = useMessages();
  const titles: Record<Exclude<View, "menu">, string> = { model: m.chat.picker.model, effort: m.chat.picker.effort, mode: m.chat.picker.mode, profession: m.chat.picker.profession };
  const [view, setView] = useState<View>("menu");
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const catalog = useCatalog();

  const current = catalog.models.find((x) => x.id === modelId);
  const efforts = current ? effortOptions(current) : [];
  const canEffort = efforts.length > 0;

  const go = (v: View) => {
    setView(v);
    setQuery("");
  };
  const close = (refocus = false) => {
    onOpenChange(false, refocus);
    setView("menu");
    setQuery("");
  };

  const currentMode = modeOptions.find((o) => o.value === mode) ?? null;
  const currentProfession = professionOptions.find((p) => p.value === profession) ?? null;
  const modelLabel = current ? shortName(current) : modelId ? modelId.split("/").pop() : m.chat.picker.model;
  const effortValue = effort && efforts.includes(effort) ? effort : null;

  const searching = query.trim().length > 0;
  /* A subscription only has a few models: all of them, no "latest releases". */
  const acp = acpAgentOf(providerId);
  /* A key agent can run any OpenRouter model: the search covers every
     vendor. A subscription only runs its own. */
  const results = searching ? searchModels(catalog.models, providerId, query, { allVendors: !acp }) : acp ? searchModels(catalog.models, providerId, "") : latestModels(catalog.models, providerId);

  const effortText = !current
    ? m.chat.picker.chooseModel
    : !canEffort
      ? m.chat.picker.doesNotReason
      : effortValue
        ? effortLabel(effortValue)
        : m.chat.picker.default;

  const choice = (key: string, title: string, sub: string | null | undefined, on: boolean, pick: () => void) => (
    <button key={key} type="button" data-item className={`cmp-item${on ? " is-on" : ""}`} aria-pressed={on} onClick={pick}>
      <span className="cmp-item-text">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      <span className="cmp-item-check">{on && <Check />}</span>
    </button>
  );

  return (
    <div className="cmp-anchor">
      <button
        ref={trigger}
        type="button"
        className={`cmp-chip${open ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={m.chat.picker.chipLabel(modelLabel ?? "", effortValue ? effortLabel(effortValue) : null)}
        disabled={disabled}
        onClick={() => (open ? close() : (go("menu"), onOpenChange(true)))}
      >
        <span className="cmp-chip-model">{modelLabel}</span>
        {effortValue && <span className="cmp-chip-effort">{effortLabel(effortValue)}</span>}
        <UpDown />
      </button>

      <ComposerPopover open={open} onClose={close} anchor={trigger} align="end" width={view === "menu" ? 292 : 316} label={m.chat.picker.conversationSettings} page={view} className={`is-${view}`}>
        {view === "menu" ? (
          <div className="cmp-group">
            {(
              [
                ["model", titles.model, current ? shortName(current) : m.common.none, false],
                ["effort", titles.effort, effortText, !canEffort],
                ["mode", titles.mode, modeOptions.length === 0 ? m.common.none : (currentMode?.name ?? m.chat.picker.default), modeOptions.length === 0],
                ["profession", titles.profession, currentProfession?.name ?? profession, false],
              ] as const
            ).map(([v, name, value, off]) => (
              <button key={v} type="button" data-item className="cmp-row" disabled={off} onClick={() => go(v)}>
                <span className="cmp-row-name">{name}</span>
                <span className="cmp-row-value">{value}</span>
                <ChevronRight className="cmp-row-go" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <header className="cmp-pop-head">
              <button type="button" className="cmp-back" onClick={() => go("menu")} aria-label={m.chat.picker.backToSettings}>
                <ChevronLeft />
                {m.chat.picker.settings}
              </button>
              <b>{titles[view]}</b>
            </header>

            {view === "model" && (
              <>
                <label className="cmp-search">
                  <Search />
                  <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={acp ? m.chat.picker.searchModelsOf(acp.label) : m.chat.picker.searchAllModels} aria-label={m.chat.picker.searchModel} />
                </label>
                <div className="cmp-list">
                  {catalog.status === "loading" || catalog.status === "idle" ? (
                    <p className="cmp-empty">{m.chat.picker.readingCatalog}</p>
                  ) : acp && catalog.acpLoading && results.length === 0 ? (
                    /* The agent publishes its models when a session opens:
                       a few seconds on the first call, during which "no
                       model" would be a lie. */
                    <p className="cmp-empty">{m.chat.picker.readingSubscription(acp.label)}</p>
                  ) : catalog.status === "error" ? (
                    <p className="cmp-empty">
                      {catalog.message}
                      <button type="button" className="cmp-retry" onClick={() => loadCatalog(true)}>
                        {m.chat.picker.reload}
                      </button>
                    </p>
                  ) : results.length === 0 ? (
                    <p className="cmp-empty">{searching ? m.chat.picker.noMatch(query) : m.chat.picker.providerEmpty}</p>
                  ) : (
                    <>
                      {!searching && <p className="cmp-caption">{acp ? m.chat.picker.yourSubscription(acp.label) : m.chat.picker.latestReleases}</p>}
                      {results.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          data-item
                          className={`cmp-item${model.id === modelId ? " is-on" : ""}`}
                          aria-pressed={model.id === modelId}
                          onClick={() => {
                            onModel(model.id);
                            close(true);
                          }}
                        >
                          <span className="cmp-item-text">
                            <b>{shortName(model)}</b>
                            {/* A subscription's model: its note; OpenRouter's: its id. */}
                            {(acp ? noteOf(model) : model.id) && <small>{acp ? noteOf(model) : model.id}</small>}
                          </span>
                          {model.contextLength !== null && <span className="cmp-item-meta">{fmtContext(model.contextLength)}</span>}
                          <span className="cmp-item-check">{model.id === modelId && <Check />}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}

            {view === "effort" && current && (
              <div className="cmp-list">
                {choice("default", m.chat.picker.default, null, effortValue === null, () => {
                  onEffort(null);
                  close(true);
                })}
                {efforts.map((e) =>
                  choice(e, e === EFFORT_OFF ? m.common.none : effortLabel(e), e === EFFORT_OFF ? m.chat.picker.noReasoning : null, e === effortValue, () => {
                    onEffort(e);
                    close(true);
                  }),
                )}
              </div>
            )}

            {view === "mode" && (
              <div className="cmp-list">
                {modeOptions.map((o) =>
                  choice(o.value, o.name, o.description, o.value === mode, () => {
                    onMode(o.value);
                    close(true);
                  }),
                )}
              </div>
            )}

            {view === "profession" && (
              <div className="cmp-list">
                {professionOptions.map((p) =>
                  choice(p.value, p.name, p.description, p.value === profession, () => {
                    onProfession(p.value);
                    close(true);
                  }),
                )}
              </div>
            )}
          </>
        )}
      </ComposerPopover>
    </div>
  );
}
