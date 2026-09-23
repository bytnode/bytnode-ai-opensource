"use client";

import type { ComponentType } from "react";
import type { Settings } from "@/lib/domain/types";
import { WatchlistView } from "./watchlist/view";
import { AlertsView } from "./alerts/view";
import { CalendarView } from "./calendar/view";
import { PaperTradingView } from "./paper-trading/view";
import { PortfolioView } from "./portfolio/view";
import { SchedulerView } from "./scheduler/view";

/* ---------------------------------------------------------------------------
   The plugins' views, by view id: each one is a small application that
   opens in its own tab. They are compiled with the app — a plugin's view
   is part of the interface, not a page loaded from elsewhere.
--------------------------------------------------------------------------- */

export type ViewProps = {
  settings: Settings;
  /** What the agent or the user asked to show first (an asset, an account). */
  params?: Record<string, unknown>;
};

export const VIEWS: Record<string, ComponentType<ViewProps>> = {
  watchlist: WatchlistView,
  alerts: AlertsView,
  calendar: CalendarView,
  "paper-trading": PaperTradingView,
  portfolio: PortfolioView,
  scheduler: SchedulerView,
};
