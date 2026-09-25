"use client";

import { useRef, useState } from "react";
import { EFFORT_OFF, effortLabel, effortOptions, latestModels, searchModels } from "@/lib/catalog/catalog";
import { loadCatalog, useCatalog } from "@/lib/catalog/use-catalog";
import type { Model } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";
import { Check, ChevronLeft, ChevronRight, Search } from "@/components/ui/icons";
import { ComposerPopover } from "./composer-popover";

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
   two "Opus" apart. */
export const shortName = (m: Model) =>
  m.name
    .replace(/^[^:]+:\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim() || m.name;

const noteOf = (m: Model) => m.name.match(/\(([^)]*)\)\s*$/)?.[1] ?? null;

const fmtContext = (n: number | null) => (n === null ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);

type View = "menu" | "model" | "effort" | "mode" | "profession";

const TITLES: Record<Exclude<View, "menu">, string> = { model: "Model", effort: "Effort", mode: "Mode", profession: "Profession" };

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
  const [view, setView] = useState<View>("menu");
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const catalog = useCatalog();

  const current = catalog.models.find((m) => m.id === modelId);
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

  const currentMode = modeOptions.find((m) => m.value === mode) ?? null;
  const currentProfession = professionOptions.find((p) => p.value === profession) ?? null;
  const modelLabel = current ? shortName(current) : modelId ? modelId.split("/").pop() : "Model";
  const effortValue = effort && efforts.includes(effort) ? effort : null;

  const searching = query.trim().length > 0;
  /* A subscription only has a few models: all of them, no "latest releases". */
  const acp = acpAgentOf(providerId);
  const results = searching ? searchModels(catalog.models, providerId, query) : acp ? searchModels(catalog.models, providerId, "") : latestModels(catalog.models, providerId);

  const effortText = !current
    ? "Choose a model"
    : !canEffort
      ? "Does not reason"
      : effortValue
        ? effortLabel(effortValue)
        : "Default";

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
        aria-label={`Conversation settings: ${modelLabel}${effortValue ? `, effort ${effortLabel(effortValue)}` : ""}`}
        disabled={disabled}
        onClick={() => (open ? close() : (go("menu"), onOpenChange(true)))}
      >
        <span className="cmp-chip-model">{modelLabel}</span>
        {effortValue && <span className="cmp-chip-effort">{effortLabel(effortValue)}</span>}
        <UpDown />
      </button>

      <ComposerPopover open={open} onClose={close} anchor={trigger} align="end" width={view === "menu" ? 292 : 316} label="Conversation settings" page={view} className={`is-${view}`}>
        {view === "menu" ? (
          <div className="cmp-group">
            {(
              [
                ["model", "Model", current ? shortName(current) : "None", false],
                ["effort", "Effort", effortText, !canEffort],
                ["mode", "Mode", modeOptions.length === 0 ? "None" : (currentMode?.name ?? "Default"), modeOptions.length === 0],
                ["profession", "Profession", currentProfession?.name ?? profession, false],
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
              <button type="button" className="cmp-back" onClick={() => go("menu")} aria-label="Back to the settings">
                <ChevronLeft />
                Settings
              </button>
              <b>{TITLES[view]}</b>
            </header>

            {view === "model" && (
              <>
                <label className="cmp-search">
                  <Search />
                  <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all models" aria-label="Search a model" />
                </label>
                <div className="cmp-list">
                  {catalog.status === "loading" || catalog.status === "idle" ? (
                    <p className="cmp-empty">Reading the catalog…</p>
                  ) : acp && catalog.acpLoading && results.length === 0 ? (
                    /* The agent publishes its models when a session opens:
                       a few seconds on the first call, during which "no
                       model" would be a lie. */
                    <p className="cmp-empty">Reading the models of your {acp.label} subscription…</p>
                  ) : catalog.status === "error" ? (
                    <p className="cmp-empty">
                      {catalog.message}
                      <button type="button" className="cmp-retry" onClick={() => loadCatalog(true)}>
                        Reload
                      </button>
                    </p>
                  ) : results.length === 0 ? (
                    <p className="cmp-empty">{searching ? `No model matches "${query}".` : "This provider has no model."}</p>
                  ) : (
                    <>
                      {!searching && <p className="cmp-caption">{acp ? `Your ${acp.label} subscription` : "Latest releases"}</p>}
                      {results.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          data-item
                          className={`cmp-item${m.id === modelId ? " is-on" : ""}`}
                          aria-pressed={m.id === modelId}
                          onClick={() => {
                            onModel(m.id);
                            close(true);
                          }}
                        >
                          <span className="cmp-item-text">
                            <b>{shortName(m)}</b>
                            {/* A subscription's model: its note; OpenRouter's: its id. */}
                            {(acp ? noteOf(m) : m.id) && <small>{acp ? noteOf(m) : m.id}</small>}
                          </span>
                          {m.contextLength !== null && <span className="cmp-item-meta">{fmtContext(m.contextLength)}</span>}
                          <span className="cmp-item-check">{m.id === modelId && <Check />}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}

            {view === "effort" && current && (
              <div className="cmp-list">
                {choice("default", "Default", null, effortValue === null, () => {
                  onEffort(null);
                  close(true);
                })}
                {efforts.map((e) =>
                  choice(e, e === EFFORT_OFF ? "None" : effortLabel(e), e === EFFORT_OFF ? "No reasoning" : null, e === effortValue, () => {
                    onEffort(e);
                    close(true);
                  }),
                )}
              </div>
            )}

            {view === "mode" && (
              <div className="cmp-list">
                {modeOptions.map((m) =>
                  choice(m.value, m.name, m.description, m.value === mode, () => {
                    onMode(m.value);
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
