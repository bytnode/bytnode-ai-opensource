"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Close, Trash } from "@/components/ui/icons";
import { PAPER_NAV_DEFAULT, PAPER_NAV_MAX, PAPER_NAV_MIN, PAPER_TRADE_DEFAULT, PAPER_TRADE_MAX, PAPER_TRADE_MIN, clampPaperNavWidth, clampPaperTradeWidth, updateUiPrefs, useUiPrefs } from "@/lib/state/ui";
import type { ViewProps } from "../views";
import { ColumnHandle } from "../column-handle";
import { fmt } from "../bits";
import { ItemMenu, useItemMenu } from "../item-menu";
import { callPlugin } from "@/lib/plugins/client";
import { act, usePluginData, viewTransport } from "../use-plugin-data";
import { useAwakeInterval, useOnWake } from "../view-activity";
import { useLiveQuotes } from "../use-live-quotes";
import { useReportExport } from "../use-report-export";
import type { Listed, Priced } from "@/lib/plugins/shared/prices";
import { Books } from "./books";
import { Market } from "./market";
import { focusSymbol, type BookRow, type Focus, type PaperState } from "./format";
import { Sheet } from "./sheet";
import { Card, Ticket } from "./ticket";
import { useMessages } from "@/lib/i18n/react";
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

   A portfolio opens in place in the left column (its positions and
   holdings under it); a click on one of them shows it alone in the middle
   sheet (`focus`), and its pair becomes the ticket's; a click on the
   portfolio itself shows the whole again. The portfolio shown is open
   unless folded by hand, and an order placed from the ticket shows what
   it opened or bought under it, alone in the sheet — its own page. A
   right click on a portfolio deletes it (never the last one).

   The portfolio shown is the one clicked, else the one a notification
   opened the tab on (`params.portfolio`), else the default one. The list is
   read every 30 s, the chosen portfolio every 15 s (each reading also fills
   the limits the market reached, and says so), the ticket's price every
   5 s. Every action reads both again at once.
--------------------------------------------------------------------------- */

const REFRESH = 15_000;
const BOOKS_MS = 30_000;

export function PaperTradingView({ settings, params }: ViewProps) {
  const m = useMessages();
  const t = m.paperTrading;
  const ui = useUiPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const focus0 = typeof params?.portfolio === "string" ? params.portfolio : null;
  const [pick, setPick] = useState<{ focus: string | null; id: string | null }>({ focus: focus0, id: null });
  const chosen = (pick.focus === focus0 ? pick.id : null) ?? focus0;

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
     live (streamed, ../use-live-quotes.ts); BytNode's pairs, read once and again when the tab wakes. */
  const [symbol, setSymbol] = useState("BTC/USDT");
  const stream = useLiveQuotes([symbol], settings);
  const streamed = stream.quotes.get(symbol);
  const failed = stream.errors.get(symbol);
  const live: Priced | null = streamed ?? (failed ? { symbol, error: failed } : null);
  const pairsData = usePluginData<Listed[]>("paper-trading", "pairs", settings, {}, { keep: "latest" });
  useOnWake(pairsData.reload);
  const pairs = Array.isArray(pairsData.data) && pairsData.data.length ? pairsData.data : null;
  const pairsUnavailable = !settings.keys.bytnode.trim() ? t.pairsNeedKey : pairsData.data && !pairs ? t.pairsUnreadable : null;
  const showPair = (s: string) => {
    setSymbol(s);
    if (ui.paperTradeClosed) updateUiPrefs({ paperTradeClosed: false });
  };
  const [problem, setProblem] = useState<string | null>(null);
  /* Opened or folded by hand; else the portfolio shown is open. */
  const [unfold, setUnfold] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<{ portfolio: string; focus: Focus } | null>(null);
  /* Only while it is still held: a position closed meanwhile (here, by a
     liquidation or by an agent) gives the whole portfolio back. */
  const focus =
    focused && data && focused.portfolio === data.id && (focused.focus.kind === "position" ? data.valuation.positions.some((p) => focused.focus.kind === "position" && p.symbol === focused.focus.symbol) : data.valuation.holdings.some((h) => focused.focus.kind === "holding" && h.asset === focused.focus.asset))
      ? focused.focus
      : null;
  const [confirm, setConfirm] = useState<{ kind: "reset" } | { kind: "delete"; id: string; name: string } | null>(null);
  const menu = useItemMenu();

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
    setFocused(null);
    setPick({ focus: focus0, id: next });
  };
  const shown = data?.id ?? id;
  const isOpen = (book: string) => unfold[book] ?? book === shown;
  const expanded = (list ?? []).map((b) => b.id).filter(isOpen);
  /* Opening another portfolio shows it too: only the one shown has its
     positions read. */
  const expand = (book: string) => {
    if (book !== shown) {
      choose(book);
      setUnfold((u) => ({ ...u, [book]: true }));
      return;
    }
    setUnfold((u) => ({ ...u, [book]: !isOpen(book) }));
  };
  /* A click on a portfolio: another one is shown, open; the one shown
     with one of its positions alone comes back to the whole; else it
     opens or closes, like its chevron. */
  const pickBook = (book: string) => {
    if (book !== shown) {
      choose(book);
      setUnfold((u) => ({ ...u, [book]: true }));
    } else if (focus) setFocused(null);
    else setUnfold((u) => ({ ...u, [book]: !isOpen(book) }));
  };
  /* An order placed: its portfolio opens, and what it opened or bought is
     shown on its own (once the next reading holds it). */
  const placed = (opened?: Focus) => {
    reload();
    setUnfold((u) => ({ ...u, [id]: true }));
    if (opened) {
      setFocused({ portfolio: id, focus: opened });
      showPair(focusSymbol(opened));
    }
  };
  const show = (f: Focus) => {
    if (!data) return;
    setProblem(null);
    setFocused({ portfolio: data.id, focus: f });
    showPair(focusSymbol(f));
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
          onPick={pickBook}
          expanded={expanded}
          onExpand={expand}
          data={data}
          focus={focus}
          onFocus={show}
          onCreate={create}
          onMenu={(e, book) => menu.open(e, { kind: "portfolio", id: book })}
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
          label={t.navWidth}
        />
        <Sheet
          data={data}
          loading={state.loading}
          problem={problem ?? state.error ?? (stream.state === "unavailable" ? stream.problem : null)}
          many={(list?.length ?? 0) > 1}
          tradeClosed={closed}
          exportButton={report.button(!data)}
          exportResult={report.result}
          onReload={reload}
          onReset={() => setConfirm({ kind: "reset" })}
          onDelete={() => data && setConfirm({ kind: "delete", id: data.id, name: data.name })}
          onOpenTrade={() => updateUiPrefs({ paperTradeClosed: false })}
          onRename={(name) => run("rename", { name })}
          onAct={run}
          onSymbol={showPair}
          focus={focus}
          onUnfocus={() => setFocused(null)}
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
              label={t.tradeWidth}
            />
            <section className="wlv-pane ptv-trade" aria-label={t.newOrderLabel}>
              <header className="ptv-trade-bar">
                <h2 className="wlv-title">
                  <span className="pv-ink">{t.trade}</span>
                </h2>
                <button type="button" className="wlv-icon" onClick={() => updateUiPrefs({ paperTradeClosed: true })} aria-label={t.closeTrade} title={t.closeTradeHint}>
                  <Close />
                </button>
              </header>
              <Card data={data} />
              <Ticket data={data} portfolio={id} settings={settings} symbol={symbol} onSymbol={setSymbol} quote={live} pairs={pairs} pairsUnavailable={pairsUnavailable} onPlaced={placed} />
            </section>
          </>
        )}
      </div>
      {menu.at && (
        <ItemMenu
          at={menu.at}
          label={t.menuLabel}
          items={
            (list?.length ?? 0) > 1
              ? [
                  {
                    label: t.deletePortfolio,
                    icon: <Trash />,
                    danger: true,
                    onSelect: () => {
                      const book = list?.find((b) => b.id === menu.at?.id);
                      if (book) setConfirm({ kind: "delete", id: book.id, name: book.name });
                    },
                  },
                ]
              : [{ label: t.lastCannotGo, icon: <Trash />, disabled: true, onSelect: () => {} }]
          }
          onClose={menu.close}
        />
      )}
      {confirm?.kind === "reset" && (
        <ConfirmDialog
          title={t.resetTitle(data?.name ?? t.thisPortfolio)}
          body={t.resetBody(data ? `${fmt(data.capital)} USDT` : null)}
          confirmLabel={t.resetConfirm}
          onConfirm={() => {
            setConfirm(null);
            void run("reset", data ? { capital: data.capital } : {});
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title={t.deleteTitle(confirm.name)}
          body={t.deleteBody}
          confirmLabel={m.common.delete}
          onConfirm={() => {
            const gone = confirm.id;
            setConfirm(null);
            void run("delete", { portfolio: gone }).then((p) => !p && gone === shown && setPick({ focus: focus0, id: null }));
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
