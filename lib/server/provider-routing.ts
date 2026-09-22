/* ---------------------------------------------------------------------------
   Which provider the request goes to.

   ⚠️ THE SAME MODEL IS SERVED BY SEVERAL PROVIDERS, AND THEIR LATENCIES
   HAVE NOTHING IN COMMON. By default, OpenRouter load-balances: the same
   question can answer in 3 s or in 90 s depending on who receives it —
   measured, the same turn took 5 s and 98 s a few minutes apart. For a
   chat, it is latency that matters, not the price per token: so we
   explicitly ask for the fastest provider, and rule out the ones that have
   proven durably slow.

   Adjustable without touching the code:
     OPENROUTER_PROVIDER_SORT      latency (default) | throughput | price
     OPENROUTER_IGNORE_PROVIDERS   list (default: parasail); empty = no one
     OPENROUTER_PROVIDER_ORDER     explicit order; takes priority over sort
     OPENROUTER_ALLOW_FALLBACKS    0 to forbid any other provider
--------------------------------------------------------------------------- */

export type ProviderRouting = {
  sort?: "latency" | "throughput" | "price";
  order?: string[];
  ignore?: string[];
  allow_fallbacks: boolean;
};

type Env = { sort?: string; ignore?: string; order?: string; fallbacks?: string };

const SORTS = ["latency", "throughput", "price"] as const;

/** A hand-written list: commas, semicolons, spaces. */
const list = (v: string) =>
  v
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function providerRouting(env: Env): ProviderRouting {
  const ignore = list(env.ignore ?? "parasail").map((x) => x.toLowerCase());
  const order = env.order === undefined ? [] : list(env.order);
  const sort = SORTS.find((s) => s === (env.sort ?? "").trim().toLowerCase());

  return {
    /* An explicit order replaces the sort: the two together make no sense,
       OpenRouter would follow the order. */
    ...(order.length ? { order } : { sort: sort ?? "latency" }),
    ...(ignore.length ? { ignore } : {}),
    allow_fallbacks: !["0", "false", "non"].includes((env.fallbacks ?? "1").trim().toLowerCase()),
  };
}

/** The routing as requests use it, read from the environment. */
export const PROVIDER_ROUTING = providerRouting({
  sort: process.env.OPENROUTER_PROVIDER_SORT,
  ignore: process.env.OPENROUTER_IGNORE_PROVIDERS,
  order: process.env.OPENROUTER_PROVIDER_ORDER,
  fallbacks: process.env.OPENROUTER_ALLOW_FALLBACKS,
});
