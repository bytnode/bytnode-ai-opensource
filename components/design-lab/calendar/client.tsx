"use client";

import dynamic from "next/dynamic";

/* The review depends on today's date: rendered in the browser only, never
   on the server (whose clock and time zone are not the viewer's). */
export const CalendarLabClient = dynamic(() => import("./lab").then((m) => m.CalendarLab), { ssr: false });
