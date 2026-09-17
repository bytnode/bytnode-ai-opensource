import { describe, expect, it } from "vitest";
import { validateArgs } from "../validate";
import {
  CONCURRENCY,
  MAX_TASKS,
  failureBody,
  parseWorkflowReport,
  readTasks,
  reportSection,
  runInPool,
  subagentFrame,
  subagentMessage,
  workflowDescription,
  workflowParameters,
  type SubagentTask,
} from "./subagent";

const task = (over: Partial<SubagentTask> = {}): SubagentTask => ({ title: "Lire le funding", prompt: "Regarde le funding BTC.", profession: "analyste", ...over });

describe("workflowParameters", () => {
  it("exige un titre, une profession parmi les quatre et un prompt", () => {
    const schema = workflowParameters({ kind: "openrouter" });
    expect(validateArgs(schema, { tasks: [task()] })).toBeNull();
    expect(validateArgs(schema, { tasks: [{ title: "x", prompt: "y" }] })).toMatch(/profession/);
    expect(validateArgs(schema, { tasks: [{ title: "x", prompt: "y", profession: "trader" }] })).toMatch(/hors liste/);
    expect(validateArgs(schema, { tasks: [{ title: "x", prompt: "y", profession: "quantitatif" }] })).toBeNull();
  });

  it("borne le modele a la liste de l'agent quand elle est connue", () => {
    const schema = workflowParameters({ kind: "list", ids: ["haiku", "opus"] });
    expect(validateArgs(schema, { tasks: [task({ model: "opus" })] })).toBeNull();
    expect(validateArgs(schema, { tasks: [task({ model: "gpt-5" })] })).toMatch(/model/);
    /* Sans liste ni OpenRouter : libre. */
    expect(validateArgs(workflowParameters({ kind: "list", ids: [] }), { tasks: [task({ model: "n'importe" })] })).toBeNull();
    expect(validateArgs(workflowParameters({ kind: "openrouter" }), { tasks: [task({ model: "openai/gpt-5-mini" })] })).toBeNull();
  });
});

describe("workflowDescription", () => {
  it("nomme les quatre metiers et la regle du modele", () => {
    const d = workflowDescription({ kind: "openrouter" });
    for (const id of ["standard", "analyste", "strategique", "quantitatif"]) expect(d).toContain(id);
    expect(d).toContain("OpenRouter");
    expect(d).toContain("difficulté");
    expect(workflowDescription({ kind: "list", ids: ["haiku", "opus"] })).toContain("parmi : haiku, opus");
    expect(workflowDescription({ kind: "list", ids: [] })).toContain("un des modèles de ton agent");
  });
});

describe("readTasks", () => {
  it("garde les taches dans l'ordre, a leur index, avec un titre par defaut", () => {
    const out = readTasks([
      { title: "  A  ", prompt: "p1", profession: "standard", model: " haiku " },
      { prompt: "p2", profession: "quantitatif" },
    ]);
    expect(out).toEqual({
      tasks: [
        { title: "A", prompt: "p1", profession: "standard", model: "haiku" },
        { title: "Tâche 2", prompt: "p2", profession: "quantitatif" },
      ],
    });
  });

  it("refuse l'appel entier des qu'une tache est incomplete — les index du fil restent justes", () => {
    expect(readTasks([{ title: "ok", prompt: "p", profession: "analyste" }, { title: "sans prompt", profession: "analyste" }])).toEqual({ error: "La tâche 2 n'a pas de prompt." });
    expect(readTasks([{ title: "x", prompt: "p", profession: "trader" }])).toMatchObject({ error: expect.stringContaining("tâche 1") });
    expect(readTasks([null])).toMatchObject({ error: expect.stringContaining("profession") });
    expect(readTasks(undefined)).toMatchObject({ error: expect.stringContaining("au moins une tâche") });
    expect(readTasks([])).toMatchObject({ error: expect.stringContaining("au moins une tâche") });
  });

  it("borne a MAX_TASKS", () => {
    const many = Array.from({ length: MAX_TASKS + 3 }, (_, i) => ({ title: `t${i}`, prompt: "p", profession: "standard" }));
    const out = readTasks(many);
    expect("tasks" in out && out.tasks).toHaveLength(MAX_TASKS);
  });
});

describe("runInPool", () => {
  it("execute CONCURRENCY taches a la fois et rend les resultats a l'index de leur tache", async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task({ title: `t${i}` }));
    let running = 0;
    let peak = 0;
    const out = await runInPool(tasks, async (t, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, i % 2 ? 2 : 6));
      running--;
      return `${i}:${t.title}`;
    });
    expect(peak).toBe(CONCURRENCY);
    expect(out).toEqual(tasks.map((t, i) => `${i}:${t.title}`));
  });
});

describe("subagentFrame / subagentMessage", () => {
  it("dit le metier, le dossier, le prompt de la profession et les interdits", () => {
    const s = subagentFrame("quantitatif", "## Profession : quant\n\nTu codes.", "C:\\ws");
    expect(s).toContain("sous-agent Quantitatif");
    expect(s).toContain("`C:\\ws`");
    expect(s).toContain("Tu codes.");
    expect(s).toMatch(/pas de sous-agents/);
    expect(s).toMatch(/pas d'ordre/);
    expect(s).toContain("rapport");
  });

  it("met le contexte commun avant la tache", () => {
    expect(subagentMessage(task(), "  Contexte : BTC.  ")).toBe("Contexte : BTC.\n\nRegarde le funding BTC.");
    expect(subagentMessage(task(), "   ")).toBe("Regarde le funding BTC.");
    expect(subagentMessage(task())).toBe("Regarde le funding BTC.");
  });
});

describe("reportSection / parseWorkflowReport", () => {
  it("redecoupe ce que reportSection a assemble, metier compris", () => {
    const out = [
      reportSection(task(), "Le funding est **positif**.\n\n## Détail\n\n- 0,01 %"),
      reportSection(task({ title: "Backtest\nrapide", profession: "quantitatif" }), failureBody("Python absent")),
      reportSection(task({ title: "Vide", profession: "strategique" }), "   "),
    ].join("\n\n");
    expect(parseWorkflowReport(out)).toEqual([
      { title: "Lire le funding", profession: "analyste", body: "Le funding est **positif**.\n\n## Détail\n\n- 0,01 %", failed: false },
      { title: "Backtest rapide", profession: "quantitatif", body: "[échec : Python absent]", failed: true },
      { title: "Vide", profession: "strategique", body: "(rapport vide)", failed: false },
    ]);
  });

  it("ignore ce qui precede le premier en-tete et une sortie sans en-tete", () => {
    expect(parseWorkflowReport("Donnez au moins une tâche.")).toEqual([]);
    expect(parseWorkflowReport("bruit\n## A — Standard\n\ncorps")).toEqual([{ title: "A", profession: "standard", body: "corps", failed: false }]);
  });
});
