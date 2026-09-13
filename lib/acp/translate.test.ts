import { describe, expect, it } from "vitest";
import { eventsOfUpdate, modelsOfConfig, modelsOfSession, effortsOfConfig, pickPermissionOption, toolOutputOf, DEFAULT_MODEL } from "./translate";
import type { SessionConfigOption, SessionUpdate, PermissionOption } from "@agentclientprotocol/sdk";

describe("eventsOfUpdate", () => {
  it("traduit un morceau de texte de l'agent", () => {
    const u: SessionUpdate = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Bonjour" } };
    expect(eventsOfUpdate(u)).toEqual([{ type: "text", text: "Bonjour" }]);
  });

  it("traduit le raisonnement, et ignore les messages utilisateur rejoues", () => {
    expect(eventsOfUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } })).toEqual([
      { type: "thought", text: "hmm" },
    ]);
    expect(eventsOfUpdate({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "salut" } })).toEqual([]);
  });

  it("traduit le plan et le decompte d'usage", () => {
    expect(
      eventsOfUpdate({
        sessionUpdate: "plan",
        entries: [
          { content: "lire les données", status: "completed", priority: "high" },
          { content: "backtester", status: "pending", priority: "medium" },
        ],
      }),
    ).toEqual([
      {
        type: "plan",
        entries: [
          { content: "lire les données", status: "completed" },
          { content: "backtester", status: "pending" },
        ],
      },
    ]);
    expect(eventsOfUpdate({ sessionUpdate: "usage_update", used: 33_502, size: 1_000_000, cost: { amount: 0.2487, currency: "USD" } })).toEqual([
      { type: "usage", usage: { context: 33_502, window: 1_000_000, cost: 0.2487 } },
    ]);
  });

  it("ouvre un appel d'outil avec son titre et ses arguments bruts", () => {
    const u: SessionUpdate = {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "Read src/index.ts",
      name: "Read",
      kind: "read",
      status: "pending",
      rawInput: { file_path: "src/index.ts" },
    };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "c1", name: "Read", args: { file_path: "src/index.ts" } }]);
  });

  it("nomme l'appel par sa categorie quand l'agent ne donne pas de nom, et garde le titre", () => {
    const u: SessionUpdate = { sessionUpdate: "tool_call", toolCallId: "c2", title: "ls -la", kind: "execute", status: "in_progress" };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "c2", name: "Commande", args: { title: "ls -la" } }]);
  });

  it("cloture un appel termine avec sa sortie texte", () => {
    const u: SessionUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "const a = 1;" } }],
    };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_result", id: "c1", ok: true, output: "const a = 1;" }]);
  });

  it("cloture un appel echoue", () => {
    const u: SessionUpdate = { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed", rawOutput: "boom" };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_result", id: "c1", ok: false, output: "boom" }]);
  });

  it("ne cloture rien tant que l'appel est en cours, mais transmet les arguments precises", () => {
    expect(eventsOfUpdate({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress" })).toEqual([]);
    const u: SessionUpdate = { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "Find `*`", rawInput: { pattern: "*" }, _meta: { claudeCode: { toolName: "Glob" } } };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_update", id: "c1", name: "Glob", args: { pattern: "*" } }]);
  });

  it("prend le nom d'outil que Claude Code glisse dans les metadonnees", () => {
    const u: SessionUpdate = { sessionUpdate: "tool_call", toolCallId: "c3", title: "Find `*`", kind: "search", status: "pending", rawInput: {}, _meta: { claudeCode: { toolName: "Glob" } } };
    expect(eventsOfUpdate(u)).toEqual([{ type: "tool_call", id: "c3", name: "Glob", args: { title: "Find `*`" } }]);
  });
});

describe("toolOutputOf", () => {
  it("resume un diff par son chemin", () => {
    const out = toolOutputOf({
      toolCallId: "c",
      content: [{ type: "diff", path: "C:/w/a.ts", oldText: "a", newText: "b" }],
    });
    expect(out).toContain("C:/w/a.ts");
    expect(out).toContain("b");
  });

  it("pour un echec, prefere l'erreur brute au diff", () => {
    const out = toolOutputOf({ toolCallId: "c", status: "failed", rawOutput: "InputValidationError", content: [{ type: "diff", path: "a.txt", newText: "ok" }] });
    expect(out).toBe("InputValidationError");
  });

  it("sans contenu, prend la sortie brute", () => {
    expect(toolOutputOf({ toolCallId: "c", rawOutput: { ok: true } })).toBe('{"ok":true}');
  });
});

describe("modelsOfConfig", () => {
  const options: SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "sonnet",
      options: [
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet", description: "Rapide" },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  ];

  it("prefixe les ids et garde l'ordre de l'agent comme ordre de nouveaute", () => {
    const models = modelsOfConfig("openai", options, []);
    expect(models.map((m) => m.id)).toEqual(["acp:openai/opus", "acp:openai/sonnet"]);
    expect(models[0].created).toBeGreaterThan(models[1].created);
    expect(models[0].providerId).toBe("acp:openai");
    expect(models[0].variant).toBeNull();
  });

  it("porte les efforts publies par l'agent, et l'effort courant comme defaut", () => {
    const models = modelsOfConfig("openai", options, []);
    expect(models[0].efforts).toEqual(["low", "medium", "high"]);
    expect(models[0].defaultEffort).toBe("medium");
    expect(models[0].reasoningMandatory).toBe(true);
  });

  it("reprend les efforts fixes quand l'agent n'en publie pas", () => {
    const models = modelsOfConfig("claude", [options[0]], ["max", "high"]);
    expect(models[0].efforts).toEqual(["max", "high"]);
    expect(models[0].defaultEffort).toBeNull();
  });

  it("aplatit les groupes d'options", () => {
    const grouped: SessionConfigOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "a",
      options: [{ group: "g", name: "G", options: [{ value: "a", name: "A" }] }],
    };
    expect(modelsOfConfig("gemini", [grouped], []).map((m) => m.id)).toEqual(["acp:gemini/a"]);
  });

  it("lit l'ancien champ `models` (Gemini CLI) quand il n'y a pas d'option modele", () => {
    const models = modelsOfSession("gemini", { models: { availableModels: [{ modelId: "auto", name: "Auto" }, { modelId: "gemini-2.5-pro", name: "gemini-2.5-pro" }], currentModelId: "auto" } }, []);
    expect(models.map((m) => m.id)).toEqual(["acp:gemini/auto", "acp:gemini/gemini-2.5-pro"]);
  });

  it("sans aucun modele publie, propose « par defaut »", () => {
    const models = modelsOfSession("copilot", { configOptions: [{ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "a", options: [{ value: "a", name: "A" }] }] }, []);
    expect(models.map((m) => m.id)).toEqual([`acp:copilot/${DEFAULT_MODEL}`]);
    expect(models[0].name).toBe("Par défaut");
  });

  it("effortsOfConfig retourne l'option d'effort et sa valeur", () => {
    expect(effortsOfConfig(options)).toEqual({ configId: "reasoning_effort", values: ["low", "medium", "high"], current: "medium" });
    expect(effortsOfConfig([options[0]])).toBeNull();
  });
});

describe("pickPermissionOption", () => {
  const options: PermissionOption[] = [
    { optionId: "a1", name: "Allow", kind: "allow_once" },
    { optionId: "aa", name: "Always", kind: "allow_always" },
    { optionId: "r1", name: "Reject", kind: "reject_once" },
  ];
  it("autorise une fois, ou toujours si demande et disponible", () => {
    expect(pickPermissionOption(options, true, false)).toBe("a1");
    expect(pickPermissionOption(options, true, true)).toBe("aa");
    expect(pickPermissionOption(options.filter((o) => o.kind !== "allow_always"), true, true)).toBe("a1");
  });
  it("refuse", () => {
    expect(pickPermissionOption(options, false, false)).toBe("r1");
  });
  it("sans option de refus, retourne null", () => {
    expect(pickPermissionOption(options.slice(0, 2), false, false)).toBeNull();
  });
});
