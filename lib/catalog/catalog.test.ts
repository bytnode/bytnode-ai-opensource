import { describe, expect, test } from "vitest";
import {
  effortOptions,
  latestModels,
  listProviders,
  parseOpenRouterModels,
  searchModels,
  searchProviders,
  byPopularity,
} from "./catalog";
import type { Model } from "@/lib/domain/types";

const raw = {
  data: [
    {
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic: Claude Sonnet 4",
      created: 1_700_000_300,
      context_length: 200000,
      reasoning: { mandatory: false, default_enabled: true, supported_efforts: ["max", "high", "low"], default_effort: "high" },
    },
    { id: "anthropic/claude-3.5-haiku", name: "Anthropic: Claude 3.5 Haiku", created: 1_700_000_100, context_length: 200000 },
    { id: "anthropic/claude-opus-4", name: "Anthropic: Claude Opus 4", created: 1_700_000_400, context_length: 200000 },
    { id: "anthropic/claude-3-opus", name: "Anthropic: Claude 3 Opus", created: 1_700_000_000, context_length: 200000 },
    { id: "openai/gpt-4o", name: "OpenAI: GPT-4o", created: 1_700_000_200, context_length: 128000 },
    { id: "meta-llama/llama-3-70b", name: "Meta: Llama 3 70B", created: 1_700_000_050, context_length: null },
    /* A variant and an alias: searchable, but never « latest releases ». */
    { id: "anthropic/claude-opus-4:batch", name: "Anthropic: Claude Opus 4 (batch)", created: 1_700_000_400, context_length: 200000 },
    { id: "~anthropic/claude-opus-latest", name: "Anthropic: Claude Opus Latest", created: 1_700_000_900, context_length: 200000 },
  ],
};

const models = (): Model[] => parseOpenRouterModels(raw);

describe("parseOpenRouterModels", () => {
  test("keeps id, name, created, context length and derives the provider from the id prefix", () => {
    const [first] = models();
    expect(first).toEqual({
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic: Claude Sonnet 4",
      providerId: "anthropic",
      created: 1_700_000_300,
      contextLength: 200000,
      variant: null,
      alias: false,
      efforts: ["max", "high", "low"],
      defaultEffort: "high",
      reasoningMandatory: false,
    });
  });

  test("reads whether reasoning can be switched off", () => {
    const out = parseOpenRouterModels({
      data: [
        { id: "a/forced", name: "f", created: 1, reasoning: { mandatory: true, supported_efforts: ["high", "low"] } },
        { id: "a/free", name: "f", created: 1, reasoning: { supported_efforts: ["high", "low"] } },
      ],
    });
    expect(out[0].reasoningMandatory).toBe(true);
    expect(out[1].reasoningMandatory).toBe(false);
  });

  test("a model without reasoning metadata has no efforts", () => {
    const m = models().find((x) => x.id === "openai/gpt-4o")!;
    expect(m.efforts).toEqual([]);
    expect(m.defaultEffort).toBeNull();
  });

  test("ignores malformed effort lists", () => {
    const out = parseOpenRouterModels({ data: [{ id: "a/b", name: "b", created: 1, reasoning: { supported_efforts: "high", default_effort: 3 } }] });
    expect(out[0].efforts).toEqual([]);
    expect(out[0].defaultEffort).toBeNull();
  });

  test("reads a ':variant' suffix and a '~' alias prefix", () => {
    const all = models();
    expect(all.find((m) => m.id === "anthropic/claude-opus-4:batch")).toMatchObject({ providerId: "anthropic", variant: "batch", alias: false });
    expect(all.find((m) => m.id === "~anthropic/claude-opus-latest")).toMatchObject({ providerId: "anthropic", variant: null, alias: true });
    expect(all.find((m) => m.id === "anthropic/claude-opus-4")).toMatchObject({ variant: null, alias: false });
  });

  test("returns an empty list for a malformed payload", () => {
    expect(parseOpenRouterModels(null)).toEqual([]);
    expect(parseOpenRouterModels({ data: "nope" })).toEqual([]);
  });

  test("skips entries without a slash-separated id", () => {
    const out = parseOpenRouterModels({ data: [{ id: "solo", name: "x", created: 1 }, { id: 42 }] });
    expect(out).toEqual([]);
  });
});

describe("listProviders", () => {
  test("groups models by provider with a readable name and a count, sorted by name", () => {
    expect(listProviders(models())).toEqual([
      { id: "anthropic", name: "Anthropic", modelCount: 6 },
      { id: "meta-llama", name: "Meta Llama", modelCount: 1 },
      { id: "openai", name: "OpenAI", modelCount: 1 },
    ]);
  });

  test("falls back to a capitalised id for an unknown provider", () => {
    const out = listProviders(parseOpenRouterModels({ data: [{ id: "acme-labs/thing", name: "t", created: 1 }] }));
    expect(out[0].name).toBe("Acme Labs");
  });
});

describe("latestModels", () => {
  test("returns the three most recently released base models of a provider, newest first — no variants, no aliases", () => {
    expect(latestModels(models(), "anthropic").map((m) => m.id)).toEqual([
      "anthropic/claude-opus-4",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.5-haiku",
    ]);
  });

  test("returns fewer when the provider has fewer models", () => {
    expect(latestModels(models(), "openai").map((m) => m.id)).toEqual(["openai/gpt-4o"]);
  });
});

describe("searchModels", () => {
  test("matches on id and name, case-insensitively, within one provider", () => {
    expect(searchModels(models(), "anthropic", "OPUS").map((m) => m.id)).toEqual([
      "~anthropic/claude-opus-latest",
      "anthropic/claude-opus-4",
      "anthropic/claude-opus-4:batch",
      "anthropic/claude-3-opus",
    ]);
  });

  test("an empty query lists every model of the provider, newest first", () => {
    expect(searchModels(models(), "anthropic", "  ").length).toBe(6);
    expect(searchModels(models(), "anthropic", "")[0].id).toBe("~anthropic/claude-opus-latest");
  });

  test("never returns models from another provider", () => {
    expect(searchModels(models(), "openai", "claude")).toEqual([]);
  });

  test("matches word by word, in any order", () => {
    expect(searchModels(models(), "anthropic", "opus 4 claude").map((m) => m.id)).toEqual([
      "anthropic/claude-opus-4",
      "anthropic/claude-opus-4:batch",
    ]);
    expect(searchModels(models(), "anthropic", "haiku 3.5").map((m) => m.id)).toEqual(["anthropic/claude-3.5-haiku"]);
  });

  test("allVendors: a key agent's search covers every vendor, its own first, never a subscription's", () => {
    const all = [
      ...models(),
      ...parseOpenRouterModels({
        data: [
          { id: "google/gemini-3.5-flash-lite", name: "Google: Gemini 3.5 Flash Lite", created: 1_700_000_500 },
          { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek: DeepSeek V4.1 Flash", created: 1_700_000_600 },
          { id: "acp:copilot/gemini-flash-lite", name: "Gemini Flash Lite", created: 1_700_000_700 },
        ],
      }),
    ];
    expect(searchModels(all, "deepseek", "gemini flash lite", { allVendors: true }).map((m) => m.id)).toEqual(["google/gemini-3.5-flash-lite"]);
    expect(searchModels(all, "deepseek", "flash v4.1", { allVendors: true }).map((m) => m.id)).toEqual(["deepseek/deepseek-v4.1-flash"]);
    /* Own vendor first, then the others newest first. */
    expect(searchModels(all, "openai", "o", { allVendors: true })[0].id).toBe("openai/gpt-4o");
    /* Without the option (a subscription), only the vendor's own. */
    expect(searchModels(all, "deepseek", "gemini")).toEqual([]);
  });
});

describe("searchProviders", () => {
  test("matches on name or id, case-insensitively", () => {
    const providers = listProviders(models());
    expect(searchProviders(providers, "meta").map((p) => p.id)).toEqual(["meta-llama"]);
    expect(searchProviders(providers, "LLAMA").map((p) => p.id)).toEqual(["meta-llama"]);
    expect(searchProviders(providers, "").length).toBe(3);
  });
});

describe("effortOptions", () => {
  const base = { id: "a/b", name: "b", providerId: "a", created: 1, contextLength: null, variant: null, alias: false, defaultEffort: null };

  test("appends « none » when reasoning is optional", () => {
    expect(effortOptions({ ...base, efforts: ["high", "low"], reasoningMandatory: false })).toEqual(["high", "low", "none"]);
  });

  test("keeps a published « none » last, once", () => {
    expect(effortOptions({ ...base, efforts: ["high", "none", "low"], reasoningMandatory: true })).toEqual(["high", "low", "none"]);
  });

  test("offers no « none » when reasoning is mandatory and not listed", () => {
    expect(effortOptions({ ...base, efforts: ["high", "low"], reasoningMandatory: true })).toEqual(["high", "low"]);
  });

  test("offers nothing for a model that does not reason", () => {
    expect(effortOptions({ ...base, efforts: [], reasoningMandatory: false })).toEqual([]);
  });
});

describe("byPopularity", () => {
  const p = (id: string, modelCount = 1) => ({ id, name: id, modelCount }) as Parameters<typeof byPopularity>[0][number];
  test("puts OpenAI, Anthropic, DeepSeek first, then the known vendors, then the rest by model count", () => {
    const sorted = byPopularity([p("aion-labs", 6), p("deepseek"), p("amazon"), p("anthropic"), p("zzz", 9), p("openai"), p("google")]);
    expect(sorted.map((x) => x.id)).toEqual(["openai", "anthropic", "deepseek", "google", "amazon", "zzz", "aion-labs"]);
  });
});
