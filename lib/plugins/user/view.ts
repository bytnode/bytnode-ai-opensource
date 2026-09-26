import { syntaxError } from "./sandbox";

/* ---------------------------------------------------------------------------
   The page of a plugin written by an agent.

   Served as ONE document (`composeView`): the BytNode kit first, then the
   plugin's index.html with its own CSS and JS put inline — the frame it
   runs in has no network at all (`VIEW_CSP`), not even to the app: a
   sandboxed frame has an origin of its own, which the app's `/api` refuses
   anyway. It reaches its plugin through `bn.call` only.

   `viewProblems` is PluginCheck's look at the page before it is served.
   SERVER-ONLY.
--------------------------------------------------------------------------- */

/** ⚠️ The frame's rules, sent as a header: scripts and styles inline only,
    images from data only, NO connection of any kind, and `sandbox` — an
    opaque origin, even when the URL is opened in a tab of its own: no
    cookie, no localStorage (the keys live there), no access to the app. */
export const VIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-scripts",
].join("; ");

const EXTERNAL = [
  { re: /\b(?:src|href|action|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i, what: "a URL outside the plugin" },
  { re: /url\(\s*["']?\s*(?:https?:)?\/\//i, what: "a url(…) outside the plugin" },
  { re: /@import\b/i, what: "an @import" },
  { re: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(/, what: "a network call" },
  { re: /\bnavigator\.sendBeacon\b/, what: "a network call" },
];

const LINK = /<link\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)["']?[^>]*>\s*<\/script>/gi;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

const local = (ref: string) => ref.replace(/^\.\//, "").replace(/^view\//, "");

/** What is wrong with the page, and what is worth saying about it. */
export async function viewProblems(files: Record<string, string>, declared: boolean): Promise<{ errors: string[]; notes: string[] }> {
  const errors: string[] = [];
  const notes: string[] = [];
  const view = Object.keys(files).filter((f) => f.startsWith("view/"));
  const html = files["view/index.html"];
  if (declared && !html) errors.push("plugin.json declares a `view` but view/index.html is missing.");
  if (!declared && view.length) errors.push("There are view/ files but plugin.json declares no `view`: add { \"title\", \"description\" } or delete them.");
  if (!html) return { errors, notes };

  for (const name of view) {
    for (const { re, what } of EXTERNAL) if (re.test(files[name])) errors.push(`${name} uses ${what}: the page has no network. Put what it needs in the plugin, and ask for data with bn.call("action").`);
  }
  for (const m of html.matchAll(LINK)) if (!files[`view/${local(m[1])}`]) errors.push(`index.html links ${m[1]}, which is not a file of the view.`);
  for (const m of html.matchAll(SCRIPT_SRC)) if (!files[`view/${local(m[1])}`]) errors.push(`index.html loads ${m[1]}, which is not a file of the view.`);

  const scripts: Array<[string, string]> = [...html.matchAll(INLINE_SCRIPT)].map((m, i) => [`index.html <script> #${i + 1}`, m[1]]);
  for (const name of view.filter((f) => f.endsWith(".js"))) scripts.push([name, files[name]]);
  for (const [name, code] of scripts) {
    if (/^\s*(import|export)\s/m.test(code)) {
      errors.push(`${name}: no import/export in the page — everything is inline, and \`bn\` is already there.`);
      continue;
    }
    const bad = await syntaxError(code, name, "global");
    if (bad) errors.push(`${name}: ${bad}`);
  }

  /* What breaks the kit: an !important, or a rule on the page's own
     frame (html, body, the app's panes). The look is the kit's. */
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).concat(view.filter((f) => f.endsWith(".css")).map((f) => files[f])).join("\n");
  if (/!important/i.test(styles)) errors.push("The page's CSS uses !important: it overrides the BytNode kit. Remove it — use the kit's classes and variables (plugin-design skill).");
  const frame = /(^|[\s,}])(html|body|\.bn-app|\.bn-sheet|\.bn-side)\s*(\{|,)/m.exec(styles);
  if (frame) errors.push(`The page's CSS restyles ${frame[2]}: the frame of the page is the kit's (the veil, the panes, the centring). Remove that rule.`);

  const all = view.map((f) => files[f]).join("\n");
  if (/bn-(figure|tile)-value[^"']*bn-mono|bn-mono[^"']*bn-(figure|tile)-value/.test(all)) notes.push("Figures are set in monospace (bn-mono on a bn-figure-value / bn-tile-value): the shipped tabs use the display font — bn-mono is for ids and codes.");
  if (!/\bbn\.call\s*\(/.test(all)) notes.push("The page never calls bn.call: it shows nothing of its plugin.");
  if (!/class\s*=\s*["'][^"']*\bbn-/.test(all) && !/classList|className/.test(all)) notes.push("The page does not use the BytNode kit's classes (bn-app, bn-sheet, bn-tiles…): it will not look like the app.");
  return { errors, notes };
}

const escapeScript = (code: string) => code.replace(/<\/script/gi, "<\\/script");
const escapeStyle = (code: string) => code.replace(/<\/style/gi, "<\\/style");

/** The page as served: kit first, the plugin's files inline. */
export function composeView(files: Record<string, string>, kit: { css: string; js: string }, theme: "dark" | "light"): string {
  let html = files["view/index.html"] ?? "<!doctype html><title>No page</title><p>This plugin has no page.</p>";
  html = html.replace(LINK, (tag, ref: string) => {
    const css = files[`view/${local(ref)}`];
    return css !== undefined && /stylesheet/i.test(tag) ? `<style>${escapeStyle(css)}</style>` : "";
  });
  html = html.replace(SCRIPT_SRC, (_tag, ref: string) => {
    const js = files[`view/${local(ref)}`];
    return js !== undefined ? `<script>${escapeScript(js)}</script>` : "";
  });
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style data-bn-kit>${escapeStyle(kit.css)}</style><script data-bn-kit>${escapeScript(kit.js)}</script>`;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  else html = `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
  /* The theme from the first paint; the kit follows it afterwards. */
  html = html.replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs.replace(/\sdata-theme=("[^"]*"|'[^']*'|\S+)/i, "")} data-theme="${theme}">`);
  if (!/^\s*<!doctype/i.test(html)) html = `<!doctype html>${html}`;
  return html;
}
