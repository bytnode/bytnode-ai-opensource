import { describe, expect, test } from "vitest";
import { todoTool } from "./todo";
import type { ToolContext } from "./types";
import type { AgentEvent } from "@/lib/agent/events";

/* La liste de taches de l'agent : ce qu'il envoie est affiche dans le fil
   (le meme bloc « plan » que les agents par abonnement) et lui revient en
   texte, pour qu'il sache ou il en est. */

const ctx = (events: AgentEvent[]): ToolContext => ({
  workspace: "C:/w",
  scope: "workspace",
  projectRoot: "C:/p",
  signal: new AbortController().signal,
  emit: (e) => events.push(e),
  depth: 0,
  llm: { apiKey: "", model: "m", effort: null },
  callId: "c1",
});

describe("TodoWrite", () => {
  test("publie la liste comme un plan et la rend au modele", async () => {
    const events: AgentEvent[] = [];
    const res = await todoTool.execute(
      {
        todos: [
          { content: "Lire les CSV", status: "completed" },
          { content: "Lancer le backtest", status: "in_progress" },
          { content: "Tracer la courbe", status: "pending" },
        ],
      },
      ctx(events),
    );
    expect(res.ok).toBe(true);
    expect(events).toEqual([
      {
        type: "plan",
        entries: [
          { content: "Lire les CSV", status: "completed" },
          { content: "Lancer le backtest", status: "in_progress" },
          { content: "Tracer la courbe", status: "pending" },
        ],
      },
    ]);
    expect(res.output).toBe("Liste à jour (1/3 faite) :\n[x] Lire les CSV\n[>] Lancer le backtest\n[ ] Tracer la courbe");
  });

  test("refuse une entree sans contenu ou avec un statut inconnu, sans rien publier", async () => {
    const events: AgentEvent[] = [];
    const vide = await todoTool.execute({ todos: [{ content: "  ", status: "pending" }] }, ctx(events));
    expect(vide.ok).toBe(false);
    expect(vide.output).toContain("todos[0].content");
    const statut = await todoTool.execute({ todos: [{ content: "x", status: "done" }] }, ctx(events));
    expect(statut.ok).toBe(false);
    expect(statut.output).toContain("todos[0].status");
    expect(events).toEqual([]);
  });

  test("refuse plusieurs taches en cours a la fois", async () => {
    const events: AgentEvent[] = [];
    const res = await todoTool.execute(
      { todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] },
      ctx(events),
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain("Une seule tâche");
    expect(events).toEqual([]);
  });

  test("une liste vide efface le plan", async () => {
    const events: AgentEvent[] = [];
    const res = await todoTool.execute({ todos: [] }, ctx(events));
    expect(res.ok).toBe(true);
    expect(events).toEqual([{ type: "plan", entries: [] }]);
    expect(res.output).toBe("Liste vidée.");
  });
});
