"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/domain/types";
import type { ViewEntry } from "@/lib/plugins/catalog";
import { callPlugin, reportViewError } from "@/lib/plugins/client";
import { openView } from "@/lib/state/tabs";
import { refreshUserPlugins, useUserPlugins } from "@/lib/state/user-plugins";
import { Close, Refresh } from "@/components/ui/icons";
import { useMessages } from "@/lib/i18n/react";
import { viewTransport } from "./use-plugin-data";
import { useAwakeInterval } from "./view-activity";

/* ---------------------------------------------------------------------------
   The tab of a plugin written by an agent: its page, in a frame.

   ⚠️ THE FRAME IS SANDBOXED (`allow-scripts` only) and its document comes
   with a CSP that forbids any connection (`lib/plugins/user/view.ts`): an
   origin of its own, no access to this page, to the keys in localStorage,
   to the network. Its only way out is a message to THIS component, which
   answers three things and nothing else: run an action of THAT plugin
   (`bn.call` → `POST /api/plugins/<id>/<action>`, the plugin's granted
   permissions applying there), open another tab, report an error — kept
   in the plugin's log for its agent, and shown here as a quiet band.
   The theme is posted to it live; the app's fonts too, as bytes (a frame
   with no network cannot fetch them).
--------------------------------------------------------------------------- */

type FromPage =
  | { bn: 1; type: "ready" }
  | { bn: 1; type: "call"; id: number; action: string; params: Record<string, unknown> }
  | { bn: 1; type: "open-view"; view: string; params?: Record<string, unknown> }
  | { bn: 1; type: "error"; message: string };

type Face = { family: string; data: ArrayBuffer; descriptors: FontFaceDescriptors };

let fonts: Promise<{ faces: Face[]; vars: Record<string, string> }> | null = null;

/** The app's three voices, read from its own stylesheets, as bytes. */
function appFonts(): Promise<{ faces: Face[]; vars: Record<string, string> }> {
  fonts ??= (async () => {
    const root = getComputedStyle(document.documentElement);
    const vars: Record<string, string> = {};
    const families = new Set<string>();
    for (const [name, fallback] of [
      ["--font-display", "Inter, system-ui, sans-serif"],
      ["--font-inter", "system-ui, sans-serif"],
      ["--font-mono", "ui-monospace, monospace"],
    ] as const) {
      const value = root.getPropertyValue(name).trim();
      if (!value) continue;
      vars[name === "--font-inter" ? "--font-text" : name] = `${value}, ${fallback}`;
      const first = value.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
      families.add(first);
    }
    const faces: Face[] = [];
    let total = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family").trim().replace(/^['"]|['"]$/g, "");
        if (!families.has(family)) continue;
        const ref = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
        if (!ref || total > 2_000_000) continue;
        try {
          /* Relative to the stylesheet, not to the page. */
          const res = await fetch(new URL(ref, sheet.href ?? location.href));
          if (!res.ok) continue;
          const data = await res.arrayBuffer();
          total += data.byteLength;
          const descriptors: FontFaceDescriptors = {};
          const weight = rule.style.getPropertyValue("font-weight");
          const style = rule.style.getPropertyValue("font-style");
          const range = rule.style.getPropertyValue("unicode-range");
          if (weight) descriptors.weight = weight;
          if (style) descriptors.style = style;
          if (range) descriptors.unicodeRange = range;
          faces.push({ family, data, descriptors });
        } catch {
          /* that face falls back */
        }
      }
    }
    return { faces, vars };
  })();
  return fonts;
}

export function UserPluginView({ entry, settings }: { entry: ViewEntry; settings: Settings }) {
  const m = useMessages();
  const frame = useRef<HTMLIFrameElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const id = entry.plugin.id;
  const theme = settings.theme === "light" ? "light" : "dark";
  /* The first theme goes in the URL (no flash); later ones are posted, so
     a theme change does not reload the page. */
  const [src] = useState(() => `/api/user-plugins/${encodeURIComponent(id)}/view?theme=${theme}`);
  /* The version that runs: a new activation (the agent changed the
     plugin) reloads the page — an open tab would keep the old one. */
  const known = useUserPlugins().find((p) => p.id === id)?.granted?.at ?? "";
  const [running, setRunning] = useState(known);
  const version = running || known;
  /* Every 2 s while the tab is in front: which version runs? A new one
     (the agent changed the plugin) reloads the page, live. */
  const seen = useRef("");
  const poll = useCallback(() => {
    void fetch(`/api/user-plugins/${encodeURIComponent(id)}/version`)
      .then((r) => (r.ok ? (r.json() as Promise<{ at: string }>) : null))
      .then((v) => {
        if (!v?.at) return;
        if (seen.current && seen.current !== v.at) void refreshUserPlugins();
        seen.current = v.at;
        setRunning(v.at);
      })
      .catch(() => {});
  }, [id]);
  useAwakeInterval(poll, 2_000);
  const latest = useRef({ settings, theme });

  useEffect(() => {
    latest.current = { settings, theme };
    frame.current?.contentWindow?.postMessage({ bn: 1, type: "theme", theme }, "*");
  }, [settings, theme]);

  useEffect(() => {
    const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ bn: 1, ...m }, "*");
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as FromPage;
      if (!m || m.bn !== 1) return;
      if (m.type === "ready") {
        post({ type: "theme", theme: latest.current.theme });
        void appFonts().then((f) => post({ type: "fonts", faces: f.faces, vars: f.vars }));
      } else if (m.type === "call") {
        if (typeof m.action !== "string" || typeof m.id !== "number") return;
        const params = m.params && typeof m.params === "object" && !Array.isArray(m.params) ? m.params : {};
        callPlugin(id, m.action, params, viewTransport(latest.current.settings)).then(
          (result) => post({ type: "result", id: m.id, ok: true, result }),
          (err: Error) => post({ type: "result", id: m.id, ok: false, error: err.message }),
        );
      } else if (m.type === "open-view") {
        if (typeof m.view === "string") openView(m.view, m.params && typeof m.params === "object" ? m.params : undefined);
      } else if (m.type === "error") {
        const message = String(m.message ?? "").slice(0, 800);
        setProblem(message);
        reportViewError(id, message);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id]);

  return (
    <section className="pv pv-user" aria-label={entry.title}>
      <iframe
        key={`${version}#${round}`}
        ref={frame}
        className="uv-frame"
        src={src}
        title={entry.title}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
      {problem && (
        <div className="uv-problem" role="status">
          <span>
            {m.plugins.userView.error(problem)} <small>{m.plugins.userView.agentSees}</small>
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
              setProblem(null);
              setRound((r) => r + 1);
            }}>
            <Refresh />
            {m.plugins.userView.reload}
          </button>
          <button type="button" className="uv-dismiss" onClick={() => setProblem(null)} aria-label={m.common.hide}>
            <Close />
          </button>
        </div>
      )}
    </section>
  );
}
