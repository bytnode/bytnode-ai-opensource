import type { SVGProps } from "react";

/* The tabs' icons, as a browser's favicons: one line glyph per page, on
   the 24 grid of `components/ui/icons.tsx`, in the tab's colour. A view
   without its own falls back on a plain square. */

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "aria-hidden": true, ...props });

const Chat = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" />
  </svg>
);

const Calendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

const Pulse = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 13h4l2.5-6 4 11 2.5-5H21" />
  </svg>
);

const Pie = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3a9 9 0 1 0 9 9h-9Z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15Z" />
  </svg>
);

const Flask = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 3h6M10 3v6L4.8 18.2A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.8L14 9V3" />
    <path d="M7.5 15h9" />
  </svg>
);

const Repeat = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3" />
  </svg>
);

const Bell = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 21h4" />
  </svg>
);

const Clock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

const Square = (p: P) => (
  <svg {...base(p)}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="4" />
  </svg>
);

const ICONS: Record<string, (p: P) => React.JSX.Element> = {
  home: Chat,
  calendar: Calendar,
  watchlist: Pulse,
  portfolio: Pie,
  "paper-trading": Flask,
  dca: Repeat,
  alerts: Bell,
  scheduler: Clock,
};

/** A page's icon: "home" for the conversations, else the view's id. */
export function TabIcon({ view, ...p }: P & { view: string }) {
  const Icon = ICONS[view] ?? Square;
  return <Icon {...p} />;
}
