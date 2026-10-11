/* ---------------------------------------------------------------------------
   What a plugin written by an agent may reach — like a phone app's
   permissions.

   The plugin DECLARES what it needs in `plugin.json`; the user reads the
   list in plain words (`describePermissions`) and grants it before the
   plugin runs, choosing the exchange accounts it may see. The sandbox has
   no other way out than these: a domain not listed cannot be called, an
   account not granted cannot be read, an order is only ever PROPOSED —
   parked for the user's click, like the DCA's (`ctx.confirm`).

   Code that changes without asking for more keeps running under the same
   grant; a single new permission goes back to the user (`covers`).

   Pure: shared browser / server, tested.
--------------------------------------------------------------------------- */

import { en, type Messages } from "@/lib/i18n/messages/en";

export type ExchangeAccess = "none" | "read" | "orders";

export type Permissions = {
  /** The hosts it may call: `api.example.com`, or `*.example.com` for its
      subdomains. Never everything. */
  network: string[];
  /** BytNode's market data, with the user's key (never shown to it). */
  bytnode: boolean;
  /** The exchange accounts the user picks: read them, or also propose
      orders that the user confirms one by one. */
  exchange: ExchangeAccess;
  /** Jobs run by the scheduler while the app is open. */
  schedule: boolean;
  /** Messages in the notification center. */
  notify: boolean;
};

export const EMPTY_PERMISSIONS: Permissions = { network: [], bytnode: false, exchange: "none", schedule: false, notify: false };

/** What the user granted: the permissions, the accounts, and the version
    of the plugin they reviewed. */
export type Grant = {
  permissions: Permissions;
  /** Settings ids of the accounts it may use (exchange ≠ none). */
  accounts: string[];
  /** The digest of the files that run. */
  digest: string;
  at: string;
  /** The user's approval: HMAC of id + permissions + accounts with the
      key only their browser holds (`approval.ts`). Absent or wrong: the
      plugin does not run. */
  sig?: string;
};

const HOST = /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_HOSTS = 10;

export function readPermissions(raw: unknown): { ok: true; value: Permissions } | { ok: false; errors: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, errors: ["`permissions` must be an object: { network, bytnode, exchange, schedule, notify }."] };
  const p = raw as Record<string, unknown>;
  const errors: string[] = [];
  const known = new Set(["network", "bytnode", "exchange", "schedule", "notify"]);
  for (const k of Object.keys(p)) if (!known.has(k)) errors.push(`Unknown permission \`${k}\` (known: ${[...known].join(", ")}).`);

  let network: string[] = [];
  if (p.network !== undefined) {
    if (!Array.isArray(p.network)) errors.push("`permissions.network` must be a list of hosts: [\"api.example.com\"].");
    else {
      network = [...new Set(p.network.map((h) => String(h).trim().toLowerCase()))];
      for (const h of network) if (!HOST.test(h)) errors.push(`\`permissions.network\`: "${h}" is not a host name (no scheme, no path, no port: api.example.com, or *.example.com).`);
      if (network.length > MAX_HOSTS) errors.push(`\`permissions.network\`: ${MAX_HOSTS} hosts at most.`);
    }
  }
  const flag = (k: "bytnode" | "schedule" | "notify") => {
    if (p[k] === undefined) return false;
    if (typeof p[k] !== "boolean") errors.push(`\`permissions.${k}\` must be true or false.`);
    return p[k] === true;
  };
  const exchange = (p.exchange ?? "none") as ExchangeAccess;
  if (!["none", "read", "orders"].includes(exchange)) errors.push('`permissions.exchange` must be "none", "read" or "orders".');
  const value: Permissions = { network, bytnode: flag("bytnode"), exchange, schedule: flag("schedule"), notify: flag("notify") };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

const LEVEL: Record<ExchangeAccess, number> = { none: 0, read: 1, orders: 2 };

/** Does what was granted cover what is asked now? */
export function covers(granted: Permissions, asked: Permissions): boolean {
  return (
    asked.network.every((h) => granted.network.includes(h)) &&
    (!asked.bytnode || granted.bytnode) &&
    LEVEL[asked.exchange] <= LEVEL[granted.exchange] &&
    (!asked.schedule || granted.schedule) &&
    (!asked.notify || granted.notify)
  );
}

/** What is asked beyond the grant, for the review screen. */
export function added(granted: Permissions | null, asked: Permissions): Permissions {
  if (!granted) return asked;
  return {
    network: asked.network.filter((h) => !granted.network.includes(h)),
    bytnode: asked.bytnode && !granted.bytnode,
    exchange: LEVEL[asked.exchange] > LEVEL[granted.exchange] ? asked.exchange : "none",
    schedule: asked.schedule && !granted.schedule,
    notify: asked.notify && !granted.notify,
  };
}

/** May this URL's host be called under these hosts? */
export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : h === a));
}

export type PermissionLine = { key: keyof Permissions; text: string; danger?: boolean };

/** The permissions in plain words, one line each: what the user grants.
    In English unless `m` says otherwise: the agents read these lines too
    (`check.ts`, the plugin tools); a screen passes its `useMessages()`. */
export function describePermissions(p: Permissions, m: Messages = en): PermissionLine[] {
  const t = m.plugins.permissions;
  const out: PermissionLine[] = [];
  if (p.network.length) out.push({ key: "network", text: t.network(p.network) });
  if (p.bytnode) out.push({ key: "bytnode", text: t.bytnode });
  if (p.exchange === "read") out.push({ key: "exchange", text: t.exchangeRead });
  if (p.exchange === "orders") out.push({ key: "exchange", text: t.exchangeOrders, danger: true });
  if (p.schedule) out.push({ key: "schedule", text: t.schedule });
  if (p.notify) out.push({ key: "notify", text: t.notify });
  return out;
}

export const hasAnyPermission = (p: Permissions): boolean => describePermissions(p).length > 0;
