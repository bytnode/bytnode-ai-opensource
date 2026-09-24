"use client";

import { createContext, useContext } from "react";

/* What an entry's details can do, handed down from the view rather than
   through every block: delete the entry, and name the agent that wrote it
   (a subscription agent's tool only knows its id; the settings have the
   name). */

export type CalendarActions = {
  remove(id: string): Promise<void>;
  agentName(id: string | undefined): string | null;
};

const Actions = createContext<CalendarActions>({ remove: async () => {}, agentName: () => null });

export const CalendarActionsProvider = Actions.Provider;
export const useCalendarActions = () => useContext(Actions);
