import type { Snapshot, Summary } from "./aggregate";

/* ---------------------------------------------------------------------------
   Groups of accounts — "Long term" = Binance + Kraken: a few of the user's
   exchange accounts, chosen, with their own report beside the whole and
   each account. A group holds account ids (the settings' random UUIDs —
   never a name or a key); an account removed from the settings simply
   drops out of its groups' figures.

   The group's report is the whole's, cut to its accounts: `groupSummary`
   (the same `Summary` shape, so the dashboard draws it unchanged) and
   `groupPoints` (the daily snapshots, each day's total the sum of its
   accounts' totals). Pure, tested.
--------------------------------------------------------------------------- */

export type AccountGroup = { id: string; name: string; accountIds: string[]; createdAt: string };

export const MAX_GROUP_NAME = 40;
export const MAX_GROUPS = 20;

type Failed = { error: string };

function cleanName(name: unknown, groups: AccountGroup[], except?: string): string | Failed {
  const text = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!text) return { error: "Give the group a name." };
  if (text.length > MAX_GROUP_NAME) return { error: `A group's name is at most ${MAX_GROUP_NAME} characters.` };
  if (groups.some((g) => g.id !== except && g.name.toLowerCase() === text.toLowerCase())) return { error: `A group is already named "${text}".` };
  return text;
}

function cleanIds(ids: unknown): string[] | Failed {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  return list.length ? list : { error: "Choose at least one account for the group." };
}

export function addGroup(groups: AccountGroup[], name: unknown, accountIds: unknown, id: string, now: Date): { groups: AccountGroup[]; group: AccountGroup } | Failed {
  if (groups.length >= MAX_GROUPS) return { error: `At most ${MAX_GROUPS} groups.` };
  const clean = cleanName(name, groups);
  if (typeof clean !== "string") return clean;
  const ids = cleanIds(accountIds);
  if ("error" in ids) return ids;
  const group: AccountGroup = { id, name: clean, accountIds: ids, createdAt: now.toISOString() };
  return { groups: [...groups, group], group };
}

/** A new name, a new set of accounts, or both. */
export function editGroup(groups: AccountGroup[], id: string, change: { name?: unknown; accountIds?: unknown }): { groups: AccountGroup[]; group: AccountGroup } | Failed {
  const found = groups.find((g) => g.id === id);
  if (!found) return { error: "No such group." };
  const name = change.name === undefined ? found.name : cleanName(change.name, groups, id);
  if (typeof name !== "string") return name;
  const ids = change.accountIds === undefined ? found.accountIds : cleanIds(change.accountIds);
  if ("error" in ids) return ids;
  const group = { ...found, name, accountIds: ids };
  return { groups: groups.map((g) => (g.id === id ? group : g)), group };
}

export function removeGroup(groups: AccountGroup[], id: string): { groups: AccountGroup[] } | Failed {
  return groups.some((g) => g.id === id) ? { groups: groups.filter((g) => g.id !== id) } : { error: "No such group." };
}

/** The whole's summary cut to these accounts: its total, assets, wallets,
    positions and unpriced assets are theirs alone (testnet still apart). */
export function groupSummary(summary: Summary, accountIds: string[]): Summary {
  const ids = new Set(accountIds);
  const accounts = summary.accounts.filter((a) => a.id && ids.has(a.id));
  const live = accounts.filter((a) => !a.testnet);
  const totalUsd = live.reduce((s, a) => s + a.usd, 0);
  const assets = new Map<string, { amount: number; usd: number }>();
  const wallets = { spot: 0, funding: 0, futures: 0, earn: 0 };
  for (const a of live) {
    for (const x of a.assets) {
      const o = assets.get(x.asset) ?? { amount: 0, usd: 0 };
      assets.set(x.asset, { amount: o.amount + x.amount, usd: o.usd + x.usd });
    }
    for (const w of Object.keys(wallets) as Array<keyof typeof wallets>) wallets[w] += a.wallets[w];
  }
  /* Positions and unpriced assets name their account by label. */
  const mine = (label: string, testnet?: boolean) => accounts.some((a) => a.label === label && (testnet === undefined || a.testnet === testnet));
  const positions = summary.positions.filter((p) => mine(p.label, p.testnet));
  return {
    totalUsd,
    testnetUsd: accounts.filter((a) => a.testnet).reduce((s, a) => s + a.usd, 0),
    assets: [...assets.entries()].map(([asset, a]) => ({ asset, amount: a.amount, usd: a.usd, share: totalUsd > 0 ? a.usd / totalUsd : 0 })).sort((a, b) => b.usd - a.usd),
    wallets,
    accounts,
    unpriced: summary.unpriced.filter((u) => mine(u.label)),
    positions,
    unrealizedPnl: positions.filter((p) => !p.testnet && typeof p.pnl === "number").reduce((s, p) => s + (p.pnl as number), 0),
  };
}

/** The daily snapshots as the group's: each day's total is the sum of its
    accounts' totals that day, the money in or out theirs too; a day none
    of them was filed is left out. */
export function groupPoints(points: Snapshot[], accountIds: string[]): Snapshot[] {
  const out: Snapshot[] = [];
  for (const p of points) {
    const own = accountIds.filter((id) => typeof p.accounts?.[id] === "number");
    if (!own.length) continue;
    const accounts = Object.fromEntries(own.map((id) => [id, p.accounts![id]]));
    const flows = Object.fromEntries(accountIds.filter((id) => typeof p.flows?.[id] === "number").map((id) => [id, p.flows![id]]));
    const flowUsd = Object.values(flows).reduce((s, v) => s + v, 0);
    out.push({
      date: p.date,
      at: p.at,
      totalUsd: Object.values(accounts).reduce((s, v) => s + v, 0),
      assets: {},
      accounts,
      ...(Object.keys(flows).length ? { flowUsd, flows } : {}),
    });
  }
  return out;
}
