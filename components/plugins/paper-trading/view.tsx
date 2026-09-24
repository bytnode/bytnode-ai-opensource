"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ViewProps } from "../views";
import { act, usePluginData } from "../use-plugin-data";
import { useAwakeInterval } from "../view-activity";
import { useReportExport } from "../use-report-export";
import type { PaperState } from "./format";
import { Sheet } from "./sheet";
import { Card, Ticket } from "./ticket";
import "../watchlist/watchlist.css";
import "./paper-trading.css";

/* ---------------------------------------------------------------------------
   The Paper trading tab, in the bare views' language (the watchlist's
   sheet, the calendar's tokens): on the left, a light veil with what the
   paper portfolio is worth — a banknote card, drawn on the GPU — and the
   order ticket; on the right, one sheet with everything the portfolio
   holds and has done. PAPER everywhere: nothing here is real money.

   The portfolio is read every 15 s while the tab is in front (each reading
   also fills the limits the market reached, and says so); the ticket's
   price every 5 s. Every action reads the portfolio again at once.
--------------------------------------------------------------------------- */

const REFRESH = 15_000;

export function PaperTradingView({ settings }: ViewProps) {
  const { data, error, loading, reload } = usePluginData<PaperState>("paper-trading", "state", settings, {}, { keep: "latest" });
  useAwakeInterval(reload, REFRESH);
  const report = useReportExport("paper-trading", settings);
  const [problem, setProblem] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const run = async (action: string, params: Record<string, unknown>) => {
    const p = await act("paper-trading", action, params, settings);
    setProblem(p);
    reload();
    return p;
  };

  return (
    <div className="wlv ptv">
      <div className="wlv-panel">
        <section className="wlv-pane wlv-side ptv-side" aria-label="Paper money">
          <header className="wlv-side-bar">
            <h2 className="wlv-title">
              <span className="pv-ink">Paper trading</span>
            </h2>
          </header>
          <Card data={data ?? null} />
          <Ticket
            data={data ?? null}
            settings={settings}
            onPlaced={() => {
              setProblem(null);
              reload();
            }}
          />
        </section>
        <Sheet
          data={data ?? null}
          loading={loading}
          problem={problem ?? error ?? null}
          exportButton={report.button(!data)}
          exportResult={report.result}
          onReload={reload}
          onReset={() => setResetting(true)}
          onAct={run}
        />
      </div>
      {resetting && (
        <ConfirmDialog
          title="Start the paper portfolio again?"
          body="Every paper holding, position, order and fill is erased, and the cash goes back to the starting capital set in Settings → Plugins. Nothing real is touched."
          confirmLabel="Start again"
          onConfirm={() => {
            setResetting(false);
            void run("reset", {});
          }}
          onCancel={() => setResetting(false)}
        />
      )}
    </div>
  );
}
