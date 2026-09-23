"use client";

import { useState } from "react";
import { AgendaView } from "./agenda";
import { startOfDay } from "./model";
import { MonthView } from "./month";
import { Segmented } from "./parts";
import { WeekView } from "./week";
import type { Source } from "./use-events";
import "./lab.css";

/* ---------------------------------------------------------------------------
   The calendar's design review (`/calendar`): three designs of the same
   view, side by side in time, on the app's own backdrop. A review surface,
   to be removed once a design is chosen and moved into the plugin's tab.
--------------------------------------------------------------------------- */

type Version = "month" | "week" | "agenda";

export function CalendarLab() {
  const [today] = useState(() => startOfDay(new Date()));
  const [version, setVersion] = useState<Version>("month");
  const [source, setSource] = useState<Source>("sample");

  return (
    <div className="cl">
      <div className="cl-lab">
        <span className="cl-lab-name">Calendar design review</span>
        <Segmented
          label="Design"
          value={version}
          onChange={setVersion}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
            { value: "agenda", label: "Up Next" },
          ]}
        />
        <span className="cl-spacer" />
        {source === "sample" && <span className="cl-lab-note">Sample events, for the review — not market data.</span>}
        <Segmented
          label="Data"
          value={source}
          onChange={setSource}
          options={[
            { value: "sample", label: "Sample" },
            { value: "live", label: "Your calendar" },
          ]}
        />
      </div>
      <div className="cl-sheet">
        {version === "month" && <MonthView key={source} source={source} today={today} />}
        {version === "week" && <WeekView key={source} source={source} today={today} />}
        {version === "agenda" && <AgendaView key={source} source={source} today={today} />}
      </div>
    </div>
  );
}
