/* ---------------------------------------------------------------------------
   A command that talks to this app's own API.

   The app has no login: every `/api` route acts on the user's machine, and
   one of them approves a plugin an agent wrote (`/api/user-plugins/<id>/
   approve`). The browser's cross-site guard (`lib/server/origin.ts`) cannot
   tell the user's click from `curl -H "Sec-Fetch-Site: same-origin" …` run
   by an agent's own shell: a non-browser client forges any header. So a
   shell command that names a loopback address AND an `/api` path is never
   covered by an "Always" rule (`permissions.ts` → it always asks) and is
   refused in the workspace scope (`guard.ts`).

   ⚠️ A GUARD ON THE TEXT, like the rest of `guard.ts`: a URL built at run
   time (base64, string concatenation, a script file) is not seen. It
   stops the direct form — what a prompt injection writes — not a model
   bent on getting around it.

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

/* Loopback, as a command would write it: the names, 127.x (short forms
   included), IPv6 `::1` and its mapped IPv4 form, 0.0.0.0 (reaches the local
   machine on every OS), and the numeric forms of 127.0.0.1. */
const LOOPBACK = /(?:\blocalhost\b|(?<![\w.])127(?:\.\d{1,3}){1,3}(?![\w.])|\[::1\]|(?<![\w:])::1(?![\w:])|\[::ffff:(?:127\.|7f)|(?<![\w.])0\.0\.0\.0(?![\w.])|\b0x7f(?:\.|0{0,6}1\b)|\b2130706433\b)/i;
/* Every route of the app starts with `/api`, whatever the port. */
const API_PATH = /\/api\b/i;

/** Does the command name a loopback address and an `/api` path? */
export const targetsLocalApi = (command: string): boolean => LOOPBACK.test(command) && API_PATH.test(command);

export const LOCAL_API_MESSAGE =
  "Command refused: it calls this app's own API on the local machine (a loopback address with an `/api` path). Agents do not drive BytNode-AI through its HTTP routes — the user approves plugins, settings and orders in the app itself.";
