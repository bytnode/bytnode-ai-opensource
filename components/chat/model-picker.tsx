"use client";

import { useState } from "react";
import { EFFORT_OFF, effortLabel, effortOptions, latestModels, searchModels } from "@/lib/catalog/catalog";
import { loadCatalog, useCatalog } from "@/lib/catalog/use-catalog";
import type { Model } from "@/lib/domain/types";
import { acpAgentOf } from "@/lib/acp/agents";
import { Check, ChevronDown } from "@/components/ui/icons";
import { SearchPanel } from "@/components/ui/search-panel";

type Props = {
  providerId: string;
  modelId: string | null;
  effort: string | null;
  onModel: (modelId: string) => void;
  onEffort: (effort: string | null) => void;
  /** The current mode and the ones that can be chosen: the external agent's
      modes (subscriptions) or our two permission modes. */
  mode: string | null;
  modeOptions: Array<{ value: string; name: string; description?: string | null }>;
  onMode: (mode: string) => void;
  /** The agent's profession: changes its prompt and its skills. */
  profession: string;
  professionOptions: Array<{ value: string; name: string; description?: string | null }>;
  onProfession: (profession: string) => void;
  disabled?: boolean;
  /** No background: the model in ink, the effort set back, the chevron —
      for the composer. */
  quiet?: boolean;
};

/* A model's short name: OpenRouter prefixes the vendor's name
   ("Anthropic: Claude Sonnet 4"); in a panel already filtered by vendor,
   that is noise. */
export const shortName = (m: Model) => m.name.replace(/^[^:]+:\s*/, "");

const fmtContext = (n: number | null) =>
  n === null ? "" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M ctx` : `${Math.round(n / 1000)}k ctx`;

type View = "menu" | "model" | "effort" | "mode" | "profession";

/* ---------------------------------------------------------------------------
   The conversation settings, in the composer.

   Closed: the current model, and the effort if it is set. Open: two rows —
   Model, Effort — and nothing else; each opens its own view, with a back
   button. The model: the provider's three latest releases, and a search for
   all the others. The effort: the levels THIS model accepts, as OpenRouter
   publishes them; a model that does not reason has no effort, and the row
   says so instead of disappearing.
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
  quiet,
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [query, setQuery] = useState("");
  const catalog = useCatalog();

  const current = catalog.models.find((m) => m.id === modelId);
  const efforts = current ? effortOptions(current) : [];
  const canEffort = efforts.length > 0;

  const openAt = (v: View) => {
    setView(v);
    setQuery("");
  };
  const close = () => {
    setOpen(false);
    setView("menu");
    setQuery("");
  };
  const toggle = () => {
    if (open) close();
    else {
      setView("menu");
      setOpen(true);
    }
  };

  const currentMode = modeOptions.find((m) => m.value === mode) ?? null;
  const currentProfession = professionOptions.find((p) => p.value === profession) ?? null;
  const modelLabel = current ? shortName(current) : modelId ? modelId.split("/").pop() : "Model";
  const effortValue = effort && efforts.includes(effort) ? effort : null;

  const searching = query.trim().length > 0;
  /* A subscription only has a few models: all of them, no "latest releases". */
  const acp = acpAgentOf(providerId);
  const results = searching ? searchModels(catalog.models, providerId, query) : acp ? searchModels(catalog.models, providerId, "") : latestModels(catalog.models, providerId);

  return (
    <div className="picker">
      <button
        type="button"
        className={`picker-trigger${quiet ? " is-quiet" : ""}${current || modelId ? "" : " is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Settings: ${modelLabel}${effortValue ? `, effort ${effortLabel(effortValue)}` : ""}`}
        disabled={disabled}
        onClick={toggle}
      >
        <span>{modelLabel}</span>
        {effortValue && <span className={quiet ? "picker-effort" : "picker-badge"}>{effortLabel(effortValue)}</span>}
        <ChevronDown />
      </button>

      {view === "menu" && (
        <SearchPanel open={open} onClose={close} label="Conversation settings" side="top" align="end" width={260} dense>
          <SearchPanel.Item
            title="Model"
            meta={current ? current.id : "no model"}
            onSelect={() => openAt("model")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
          <SearchPanel.Item
            title="Effort"
            meta={
              !current
                ? "choose a model first"
                : !canEffort
                  ? "this model does not reason"
                  : effortValue
                    ? effortLabel(effortValue)
                    : `default${current.defaultEffort ? ` (${effortLabel(current.defaultEffort)})` : ""}`
            }
            disabled={!canEffort}
            onSelect={() => openAt("effort")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
          <SearchPanel.Item
            title="Mode"
            meta={modeOptions.length === 0 ? "no mode" : (currentMode?.name ?? "default")}
            disabled={modeOptions.length === 0}
            onSelect={() => openAt("mode")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
          <SearchPanel.Item
            title="Profession"
            meta={currentProfession?.name ?? profession}
            onSelect={() => openAt("profession")}
            trailing={<ChevronDown className="sp-item-chevron" />}
          />
        </SearchPanel>
      )}

      {view === "model" && (
        <SearchPanel
          open={open}
          onClose={close}
          title="Model"
          onBack={() => openAt("menu")}
          query={query}
          onQuery={setQuery}
          placeholder="Search a model"
          label="Models"
          side="top"
          align="end"
          width={300}
          dense
        >
          {catalog.status === "loading" || catalog.status === "idle" ? (
            <SearchPanel.Empty>Reading the catalog…</SearchPanel.Empty>
          ) : acp && catalog.acpLoading && results.length === 0 ? (
            /* The agent publishes its models when a session opens: a few
               seconds on the first call, during which "no model" would be a
               lie. */
            <SearchPanel.Empty>Reading the models of your {acp.label} subscription…</SearchPanel.Empty>
          ) : catalog.status === "error" ? (
            <SearchPanel.Empty>
              {catalog.message}
              <br />
              <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => loadCatalog(true)}>
                Reload
              </button>
            </SearchPanel.Empty>
          ) : results.length === 0 ? (
            <SearchPanel.Empty>
              {searching ? `No model matches "${query}".` : "This provider has no model."}
            </SearchPanel.Empty>
          ) : (
            <>
              {!searching && <SearchPanel.Group>{acp ? `Models of your ${acp.label} subscription` : "Latest releases"}</SearchPanel.Group>}
              {results.map((m) => (
                <SearchPanel.Item
                  key={m.id}
                  title={shortName(m)}
                  meta={m.id}
                  selected={m.id === modelId}
                  onSelect={() => {
                    onModel(m.id);
                    close();
                  }}
                  trailing={m.id === modelId ? <Check /> : <span className="sp-item-count">{fmtContext(m.contextLength)}</span>}

                />
              ))}
            </>
          )}
        </SearchPanel>
      )}

      {view === "effort" && current && (
        <SearchPanel open={open} onClose={close} title="Effort" onBack={() => openAt("menu")} label="Effort" side="top" align="end" width={240} dense>
          <SearchPanel.Item
            title={`Default${current.defaultEffort ? ` · ${effortLabel(current.defaultEffort)}` : ""}`}
            selected={effortValue === null}
            onSelect={() => {
              onEffort(null);
              close();
            }}
            trailing={effortValue === null ? <Check /> : undefined}
          />
          {efforts.map((e) => (
            <SearchPanel.Item
              key={e}
              title={e === EFFORT_OFF ? "None · no reasoning" : effortLabel(e)}
              selected={e === effortValue}
              onSelect={() => {
                onEffort(e);
                close();
              }}
              trailing={e === effortValue ? <Check /> : undefined}
            />
          ))}
        </SearchPanel>
      )}
      {view === "mode" && (
        <SearchPanel open={open} onClose={close} title="Mode" onBack={() => openAt("menu")} label="Mode" side="top" align="end" width={300} dense>
          {modeOptions.map((m) => (
            <SearchPanel.Item
              key={m.value}
              title={m.name}
              meta={m.description ?? undefined}
              selected={m.value === mode}
              onSelect={() => {
                onMode(m.value);
                close();
              }}
              trailing={m.value === mode ? <Check /> : undefined}
            />
          ))}
        </SearchPanel>
      )}

      {view === "profession" && (
        <SearchPanel
          open={open}
          onClose={close}
          title="Profession"
          onBack={() => openAt("menu")}
          label="Profession"
          side="top"
          align="end"
          width={320}
          dense
        >
          {professionOptions.map((p) => (
            <SearchPanel.Item
              key={p.value}
              title={p.name}
              meta={p.description ?? undefined}
              selected={p.value === profession}
              onSelect={() => {
                onProfession(p.value);
                close();
              }}
              trailing={p.value === profession ? <Check /> : undefined}
            />
          ))}
        </SearchPanel>
      )}

    </div>
  );
}
