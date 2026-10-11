"use client";

import { useSyncExternalStore } from "react";
import { BrowserStorage } from "@/lib/storage/storage";
import { DEFAULT_DOCK, PANEL_DEFAULT, clampPanelHeight, clampPanelWidth, type Dock } from "@/lib/layout/float-dock";
import { createStore } from "./store";

/* Screen preferences: whether the column is collapsed, and its Agents
   section folded;
   the width of the Calendar tab's month column, of the Watchlist tab's
   list and of the Portfolio tab's accounts; the Paper trading tab's
   portfolios column, and its ticket column — its width and whether it is
   closed; the DCA tab's plans column; the floating agent — shown or not
   (its switch is in Settings → General), where its avatar rests and the
   size of its conversation. Nothing more — this is not a setting, it is
   a habit. */

export type UiPrefs = { sidebarCollapsed: boolean; agentsFolded: boolean; scheduledFolded: boolean; calendarWidth: number; watchlistWidth: number; portfolioWidth: number; paperNavWidth: number; paperTradeWidth: number; paperTradeClosed: boolean; dcaWidth: number; floatingAgent: boolean; floatDock: Dock; floatSize: { width: number; height: number } };

const KEY = "agentchat:ui";
/* The column's width: fixed, never resized (user request, 2026-10-03). */
export const SIDEBAR_WIDTH = 300;
export const CALENDAR_MIN = 300;
export const CALENDAR_MAX = 640;
export const CALENDAR_DEFAULT = 390;
export const WATCHLIST_MIN = 290;
export const WATCHLIST_MAX = 560;
export const WATCHLIST_DEFAULT = 370;
export const PORTFOLIO_MIN = 290;
export const PORTFOLIO_MAX = 560;
export const PORTFOLIO_DEFAULT = 370;
export const PAPER_NAV_MIN = 260;
export const PAPER_NAV_MAX = 520;
export const PAPER_NAV_DEFAULT = 330;
export const PAPER_TRADE_MIN = 300;
export const PAPER_TRADE_MAX = 560;
export const PAPER_TRADE_DEFAULT = 360;
export const DCA_MIN = 290;
export const DCA_MAX = 560;
export const DCA_DEFAULT = 360;

const storage = new BrowserStorage();
const defaults: UiPrefs = { sidebarCollapsed: false, agentsFolded: false, scheduledFolded: false, calendarWidth: CALENDAR_DEFAULT, watchlistWidth: WATCHLIST_DEFAULT, portfolioWidth: PORTFOLIO_DEFAULT, paperNavWidth: PAPER_NAV_DEFAULT, paperTradeWidth: PAPER_TRADE_DEFAULT, paperTradeClosed: false, dcaWidth: DCA_DEFAULT, floatingAgent: true, floatDock: DEFAULT_DOCK, floatSize: PANEL_DEFAULT };

const store = createStore<UiPrefs>(defaults, () => {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? "{}") as Partial<UiPrefs>;
    return {
      sidebarCollapsed: raw.sidebarCollapsed === true,
      agentsFolded: raw.agentsFolded === true,
      scheduledFolded: raw.scheduledFolded === true,
      calendarWidth: clampCalendarWidth(typeof raw.calendarWidth === "number" ? raw.calendarWidth : CALENDAR_DEFAULT),
      watchlistWidth: clampWatchlistWidth(typeof raw.watchlistWidth === "number" ? raw.watchlistWidth : WATCHLIST_DEFAULT),
      portfolioWidth: clampPortfolioWidth(typeof raw.portfolioWidth === "number" ? raw.portfolioWidth : PORTFOLIO_DEFAULT),
      paperNavWidth: clampPaperNavWidth(typeof raw.paperNavWidth === "number" ? raw.paperNavWidth : PAPER_NAV_DEFAULT),
      paperTradeWidth: clampPaperTradeWidth(typeof raw.paperTradeWidth === "number" ? raw.paperTradeWidth : PAPER_TRADE_DEFAULT),
      paperTradeClosed: raw.paperTradeClosed === true,
      dcaWidth: clampDcaWidth(typeof raw.dcaWidth === "number" ? raw.dcaWidth : DCA_DEFAULT),
      floatingAgent: raw.floatingAgent !== false,
      floatDock: readDock(raw.floatDock),
      floatSize: readSize(raw.floatSize),
    };
  } catch {
    return defaults;
  }
});

/* `{ edge, t }`; the first shape, `{ side, y }` (left/right only), is read
   as the same place. */
function readDock(raw: unknown): Dock {
  const d = raw as { edge?: unknown; t?: unknown; side?: unknown; y?: unknown } | undefined;
  const edge = d?.edge ?? d?.side;
  const t = d?.t ?? d?.y;
  if ((edge !== "left" && edge !== "right" && edge !== "top" && edge !== "bottom") || typeof t !== "number" || !Number.isFinite(t)) return DEFAULT_DOCK;
  return { edge, t: Math.min(1, Math.max(0, t)) };
}

function readSize(raw: unknown): { width: number; height: number } {
  const z = raw as { width?: unknown; height?: unknown } | undefined;
  return {
    width: clampPanelWidth(typeof z?.width === "number" ? z.width : PANEL_DEFAULT.width),
    height: clampPanelHeight(typeof z?.height === "number" ? z.height : PANEL_DEFAULT.height),
  };
}

export const clampCalendarWidth = (w: number) => Math.min(CALENDAR_MAX, Math.max(CALENDAR_MIN, Math.round(w)));
export const clampWatchlistWidth = (w: number) => Math.min(WATCHLIST_MAX, Math.max(WATCHLIST_MIN, Math.round(w)));
export const clampPortfolioWidth = (w: number) => Math.min(PORTFOLIO_MAX, Math.max(PORTFOLIO_MIN, Math.round(w)));
export const clampPaperNavWidth = (w: number) => Math.min(PAPER_NAV_MAX, Math.max(PAPER_NAV_MIN, Math.round(w)));
export const clampPaperTradeWidth = (w: number) => Math.min(PAPER_TRADE_MAX, Math.max(PAPER_TRADE_MIN, Math.round(w)));
export const clampDcaWidth = (w: number) => Math.min(DCA_MAX, Math.max(DCA_MIN, Math.round(w)));

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function updateUiPrefs(patch: Partial<UiPrefs>) {
  const next = { ...store.get(), ...patch };
  storage.set(KEY, JSON.stringify(next));
  store.set(next);
}
