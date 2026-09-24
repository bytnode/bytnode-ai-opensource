"use client";

import { relative, timeline, type Scheduled } from "@/lib/plugins/scheduler/timeline";

/* ---------------------------------------------------------------------------
   The next 24 hours, as one line: now on the left, a tick every three hours,
   and a dot where something will run — an agent task in blue, named above
   the line at its first run only (every other name a step higher, so two
   close ones do not collide), a plugin's job in grey. What runs every hour
   or more often would cover the line: it is listed under it, "always on".
--------------------------------------------------------------------------- */

const HOURS = 24;
const HOUR = 3_600_000;

export function Timeline({ items, now }: { items: Scheduled[]; now: number }) {
  const { marks, bands } = timeline(items, now, HOURS);
  const pos = (t: number) => `${((t - now) / (HOURS * HOUR)) * 100}%`;
  /* The ticks: every three hours, on the hour. */
  const first = Math.ceil(now / (3 * HOUR)) * 3 * HOUR;
  const ticks = Array.from({ length: 8 }, (_, i) => first + i * 3 * HOUR).filter((t) => t - now < HOURS * HOUR && t - now > HOUR * 0.6);
  let named = 0;
  const seen = new Set<string>();

  return (
    <section className="sdv-timeline" aria-label="The next 24 hours">
      <div className="sdv-timeline-head">
        <p className="sdv-block-title">
          <span className="pv-ink">Next 24 hours</span>
        </p>
        <span className="sdv-legend">
          <i className="is-task" /> Agent tasks
          <i className="is-job" /> Plugin jobs
        </span>
      </div>
      <div className="sdv-track">
        <span className="sdv-now">Now</span>
        {ticks.map((t) => (
          <span key={t} className="sdv-tick" style={{ left: pos(t) }}>
            <small>{new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</small>
          </span>
        ))}
        {marks.map((m) => {
          const label = m.kind === "task" && !seen.has(m.id);
          if (label) seen.add(m.id);
          const high = label && named++ % 2 === 1;
          return (
            <span key={`${m.id}:${m.at}`} className={`sdv-mark is-${m.kind}${high ? " is-high" : ""}`} style={{ left: pos(m.at) }} title={`${m.title} — ${relative(m.at, now)}`}>
              {label && <b>{m.title}</b>}
            </span>
          );
        })}
      </div>
      {marks.length === 0 && <p className="sdv-timeline-empty">Nothing planned in the next 24 hours{bands.length ? " but what is always on." : "."}</p>}
      {bands.length > 0 && (
        <p className="sdv-bands">
          <span>Always on</span>
          {bands.map((b) => (
            <span key={b.id} className="sdv-band">
              {b.title}
              <small>{b.every}</small>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
