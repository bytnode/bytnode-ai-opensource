"use client";

import { createContext, useContext } from "react";

/* What the agenda can do, handed down from the view rather than through
   every block: add the user's own entry, delete an entry, and name the
   agent that wrote one (a subscription agent's tool only knows its id; the
   settings have the name). */

export type NewEntry = { startsAt: string; category: string; title: string; notes: string };

export type CalendarActions = {
  /** Null when added, else why not. */
  add(entry: NewEntry): Promise<string | null>;
  remove(id: string): Promise<void>;
  agentName(id: string | undefined): string | null;
};

const Actions = createContext<CalendarActions>({ add: async () => null, remove: async () => {}, agentName: () => null });

export const CalendarActionsProvider = Actions.Provider;
export const useCalendarActions = () => useContext(Actions);
