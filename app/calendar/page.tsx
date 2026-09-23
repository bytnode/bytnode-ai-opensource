import type { Metadata } from "next";
import { CalendarLabClient } from "@/components/design-lab/calendar/client";

export const metadata: Metadata = { title: "Calendar design review — BytNode-AI" };

/* A review surface for the calendar plugin's redesign: three versions of
   the view, to be removed once one is chosen. */
export default function CalendarReviewPage() {
  return <CalendarLabClient />;
}
