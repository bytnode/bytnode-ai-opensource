"use client";

import { useSyncExternalStore } from "react";
import { BrowserStorage } from "@/lib/storage/storage";
import { createStore } from "./store";

/* Screen preferences: the column's width, and whether it is collapsed;
   the width of the Calendar tab's month column, of the Watchlist tab's
   list and of the Portfolio tab's accounts; the Paper trading tab's
   portfolios column, and its ticket column — its width and whether it is
   closed. Nothing more — this is
   not a setting, it is a habit. */

export type UiPrefs = { sidebarWidth: number; sidebarCollapsed: boolean; calendarWidth: number; watchlistWidth: number; portfolioWidth: number; paperNavWidth: number; paperTradeWidth: number; paperTradeClosed: boolean };

const KEY = "agentchat:ui";
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 320;
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

const storage = new BrowserStorage();
const defaults: UiPrefs = { sidebarWidth: SIDEBAR_DEFAULT, sidebarCollapsed: false, calendarWidth: CALENDAR_DEFAULT, watchlistWidth: WATCHLIST_DEFAULT, portfolioWidth: PORTFOLIO_DEFAULT, paperNavWidth: PAPER_NAV_DEFAULT, paperTradeWidth: PAPER_TRADE_DEFAULT, paperTradeClosed: false };

const store = createStore<UiPrefs>(defaults, () => {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? "{}") as Partial<UiPrefs>;
    return {
      sidebarWidth: clampWidth(typeof raw.sidebarWidth === "number" ? raw.sidebarWidth : SIDEBAR_DEFAULT),
      sidebarCollapsed: raw.sidebarCollapsed === true,
      calendarWidth: clampCalendarWidth(typeof raw.calendarWidth === "number" ? raw.calendarWidth : CALENDAR_DEFAULT),
      watchlistWidth: clampWatchlistWidth(typeof raw.watchlistWidth === "number" ? raw.watchlistWidth : WATCHLIST_DEFAULT),
      portfolioWidth: clampPortfolioWidth(typeof raw.portfolioWidth === "number" ? raw.portfolioWidth : PORTFOLIO_DEFAULT),
      paperNavWidth: clampPaperNavWidth(typeof raw.paperNavWidth === "number" ? raw.paperNavWidth : PAPER_NAV_DEFAULT),
      paperTradeWidth: clampPaperTradeWidth(typeof raw.paperTradeWidth === "number" ? raw.paperTradeWidth : PAPER_TRADE_DEFAULT),
      paperTradeClosed: raw.paperTradeClosed === true,
    };
  } catch {
    return defaults;
  }
});

export const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
export const clampCalendarWidth = (w: number) => Math.min(CALENDAR_MAX, Math.max(CALENDAR_MIN, Math.round(w)));
export const clampWatchlistWidth = (w: number) => Math.min(WATCHLIST_MAX, Math.max(WATCHLIST_MIN, Math.round(w)));
export const clampPortfolioWidth = (w: number) => Math.min(PORTFOLIO_MAX, Math.max(PORTFOLIO_MIN, Math.round(w)));
export const clampPaperNavWidth = (w: number) => Math.min(PAPER_NAV_MAX, Math.max(PAPER_NAV_MIN, Math.round(w)));
export const clampPaperTradeWidth = (w: number) => Math.min(PAPER_TRADE_MAX, Math.max(PAPER_TRADE_MIN, Math.round(w)));

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function updateUiPrefs(patch: Partial<UiPrefs>) {
  const next = { ...store.get(), ...patch };
  storage.set(KEY, JSON.stringify(next));
  store.set(next);
}
