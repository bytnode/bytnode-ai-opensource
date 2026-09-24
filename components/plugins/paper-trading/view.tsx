"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Close } from "@/components/ui/icons";
import { PAPER_NAV_DEFAULT, PAPER_NAV_MAX, PAPER_NAV_MIN, PAPER_TRADE_DEFAULT, PAPER_TRADE_MAX, PAPER_TRADE_MIN, clampPaperNavWidth, clampPaperTradeWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { callPlugin } from "@/lib/plugins/client";
import { act, usePluginData, viewTransport } from "../use-plugin-data";
import { useAwakeInterval, useOnWake } from "../view-activity";
import { useReportExport } from "../use-report-export";
import type { Listed, Priced } from "@/lib/plugins/shared/prices";
import { Books } from "./books";
import { Market } from "./market";
import type { BookRow, PaperState } from "./format";
import { Sheet } from "./sheet";
import { Card, Ticket } from "./ticket";
import "../watchlist/watchlist.css";
import "./paper-trading.css";

/* ---------------------------------------------------------------------------
   The Paper trading tab, in the bare views' language (the watchlist's
   sheet, the calendar's tokens), in three columns:
   - on the left, the paper portfolios (`books.tsx`), and a new one — its
     width follows the handle on its right edge;
   - in the middle, one sheet: the chosen portfolio, the market of the pair
     in the ticket, all it holds and did;
   - on the right, what it is worth — a banknote card drawn on the GPU —
     and the order ticket into it. That column is the user's: its width
     follows the handle on its left edge, and it closes (the sheet's head
     then offers "Trade" to bring it back); both are kept (`agentchat:ui`).
   PAPER everywhere: nothing here is real money.

   The portfolio shown is the one clicked, else the one a notification
   opened the tab on (`params.portfolio`), else the default one. The list is
   read every 30 s, the chosen portfolio every 15 s (each reading also fills
   the limits the market reached, and says so), the ticket's price every
   5 s. Every action reads both again at once.
--------------------------------------------------------------------------- */

const REFRESH = 15_000;
const BOOKS_MS = 30_000;
const QUOTE_MS = 5_000;

export function PaperTradingView({ settings, params }: ViewProps) {
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const focus = typeof params?.portfolio === "string" ? params.portfolio : null;
  const [pick, setPick] = useState<{ focus: string | null; id: string | null }>({ focus, id: null });
  const chosen = (pick.focus === focus ? pick.id : null) ?? focus;

  const books = usePluginData<BookRow[]>("paper-trading", "books", settings, {}, { keep: "latest" });
  useAwakeInterval(books.reload, BOOKS_MS);
  const list = Array.isArray(books.data) ? books.data : null;
  /* A portfolio deleted meanwhile (here, or by an agent) falls back to the default. */
  const id = list && chosen && !list.some((b) => b.id === chosen) ? (list[0]?.id ?? "") : (chosen ?? list?.[0]?.id ?? "");

  const state = usePluginData<PaperState>("paper-trading", "state", settings, { portfolio: id }, { keep: "exact" });
  useAwakeInterval(state.reload, REFRESH);
  /* An answer read for another portfolio (still on screen while this one loads) is not shown. */
  const data = state.data && (!id || state.data.id === id) ? state.data : null;

  const report = useReportExport("paper-trading", settings, { portfolio: id });

  /* The pair in the ticket, which the market block shows too; its price
     every 5 s; BytNode's pairs, read once and again when the tab wakes. */
  const [symbol, setSymbol] = useState("BTC/USDT");
  const quote = usePluginData<Priced>("paper-trading", "quote", settings, { symbol });
  useAwakeInterval(quote.reload, QUOTE_MS);
  const live = quote.data && quote.data.symbol === symbol ? quote.data : null;
  const pairsData = usePluginData<Listed[]>("paper-trading", "pairs", settings, {}, { keep: "latest" });
  useOnWake(pairsData.reload);
  const pairs = Array.isArray(pairsData.data) && pairsData.data.length ? pairsData.data : null;
  const pairsUnavailable = !settings.keys.bytnode.trim() ? "The list of pairs comes from BytNode: add your key in Settings → Auth." : pairsData.data && !pairs ? "BytNode's list of pairs could not be read — type a pair." : null;
  const showPair = (s: string) => {
    setSymbol(s);
    if (ui.paperTradeClosed) updateUiPrefs({ paperTradeClosed: false });
  };
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);

  const reload = () => {
    state.reload();
    books.reload();
  };
  const run = async (action: string, extra: Record<string, unknown>) => {
    const p = await act("paper-trading", action, { portfolio: id, ...extra }, settings);
    setProblem(p);
    reload();
    return p;
  };
  const choose = (next: string) => {
    setProblem(null);
    setPick({ focus, id: next });
  };
  /* A new portfolio is shown at once. */
  const create = async (name: string, capital: number) => {
    try {
      const made = await callPlugin<{ id: string }>("paper-trading", "create", { name, capital }, viewTransport(settings));
      choose(made.id);
      books.reload();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const closed = ui.paperTradeClosed;
  const defaultCapital = Number(settings.plugins?.["paper-trading"]?.config?.capital ?? 10_000) || 10_000;

  return (
    <div className="wlv ptv">
      <div className={`wlv-panel${closed ? " is-trade-closed" : ""}`} ref={panel} style={{ "--ptv-nav": `${ui.paperNavWidth}px`, "--ptv-trade": `${ui.paperTradeWidth}px` } as CSSProperties}>
        <Books
          books={list}
          selected={data?.id ?? (id || null)}
          defaultCapital={defaultCapital}
          onPick={choose}
          onCreate={create}
        />
        <ColumnHandle
          panel={panel}
          cssVar="--ptv-nav"
          width={ui.paperNavWidth}
          min={PAPER_NAV_MIN}
          max={PAPER_NAV_MAX}
          reset={PAPER_NAV_DEFAULT}
          clamp={clampPaperNavWidth}
          onCommit={(w) => updateUiPrefs({ paperNavWidth: w })}
          label="Width of the portfolios"
        />
        <Sheet
          data={data}
          loading={state.loading}
          problem={problem ?? state.error ?? null}
          many={(list?.length ?? 0) > 1}
          tradeClosed={closed}
          exportButton={report.button(!data)}
          exportResult={report.result}
          onReload={reload}
          onReset={() => setConfirm("reset")}
          onDelete={() => setConfirm("delete")}
          onOpenTrade={() => updateUiPrefs({ paperTradeClosed: false })}
          onRename={(name) => run("rename", { name })}
          onAct={run}
          onSymbol={showPair}
          market={<Market symbol={symbol} quote={live} pairs={pairs} data={data} settings={settings} />}
        />
        {!closed && (
          <>
            <ColumnHandle
              panel={panel}
              cssVar="--ptv-trade"
              side="right"
              width={ui.paperTradeWidth}
              min={PAPER_TRADE_MIN}
              max={PAPER_TRADE_MAX}
              reset={PAPER_TRADE_DEFAULT}
              clamp={clampPaperTradeWidth}
              onCommit={(w) => updateUiPrefs({ paperTradeWidth: w })}
              label="Width of the order column"
            />
            <section className="wlv-pane ptv-trade" aria-label="New paper order">
              <header className="ptv-trade-bar">
                <h2 className="wlv-title">
                  <span className="pv-ink">Trade</span>
                </h2>
                <button type="button" className="wlv-icon" onClick={() => updateUiPrefs({ paperTradeClosed: true })} aria-label="Close the order column" title="Close — “Trade” brings it back">
                  <Close />
                </button>
              </header>
              <Card data={data} />
              <Ticket data={data} portfolio={id} settings={settings} symbol={symbol} onSymbol={setSymbol} quote={live} pairs={pairs} pairsUnavailable={pairsUnavailable} onPlaced={reload} />
            </section>
          </>
        )}
      </div>
      {confirm === "reset" && (
        <ConfirmDialog
          title={`Start "${data?.name ?? "this portfolio"}" again?`}
          body={`Every paper holding, position, order and fill of this portfolio is erased, and its cash goes back to its starting ${data ? `${data.capital.toLocaleString("en-US")} USDT` : "capital"}. Nothing real is touched.`}
          confirmLabel="Start again"
          onConfirm={() => {
            setConfirm(null);
            void run("reset", data ? { capital: data.capital } : {});
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title={`Delete "${data?.name ?? "this portfolio"}"?`}
          body="The portfolio and its whole history are erased. The other paper portfolios are not touched, and nothing real is."
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirm(null);
            void run("delete", {}).then((p) => !p && setPick({ focus, id: null }));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
