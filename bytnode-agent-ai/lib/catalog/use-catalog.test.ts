import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/lib/domain/types";
import { getCatalog, loadAcpModels } from "./use-catalog";

/* Le catalogue des abonnements est relu quand un agent se connecte. Au
   demarrage a froid, la premiere lecture dure longtemps (chaque agent est
   lance pour publier ses modeles) pendant que les agents interroges par le
   protocole (Grok, Copilot, Mistral) passent a « connecté » en quelques
   secondes : la relecture qu'ils declenchent ne doit pas etre perdue. */

const model = (id: string): Model => ({
  id,
  name: id,
  providerId: id.slice(0, id.indexOf("/")),
  created: 0,
  contextLength: null,
  variant: null,
  alias: false,
  efforts: [],
  defaultEffort: null,
  reasoningMandatory: false,
});

type Pending = { resolve: (models: Model[]) => void };

describe("loadAcpModels", () => {
  const pending: Pending[] = [];

  beforeEach(() => {
    pending.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pending.push({
              resolve: (models) =>
                resolve({ ok: true, json: async () => ({ models, modes: {} }) } as Response),
            });
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejoue un chargement demandé pendant qu'un autre est en vol", async () => {
    const first = loadAcpModels();
    /* Grok vient de se connecter : le catalogue demande une relecture alors
       que la premiere, calculee sans lui, n'est pas encore revenue. */
    const second = loadAcpModels();
    expect(pending).toHaveLength(1);

    pending[0].resolve([model("acp:claude/opus")]);
    await first;
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    pending[1].resolve([model("acp:claude/opus"), model("acp:grok/grok-4.6")]);
    await second;
    expect(getCatalog().models.map((m) => m.id)).toContain("acp:grok/grok-4.6");
  });

  it("dit qu'une lecture des abonnements est en cours jusqu'à la dernière rejouée", async () => {
    const first = loadAcpModels();
    expect(getCatalog().acpLoading).toBe(true);
    const second = loadAcpModels();

    pending[0].resolve([]);
    await first;
    /* La premiere est revenue, mais la relecture demandee entre-temps est
       encore a faire : l'interface ne doit pas conclure « aucun modele ». */
    expect(getCatalog().acpLoading).toBe(true);

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve([model("acp:grok/grok-4.6")]);
    await second;
    expect(getCatalog().acpLoading).toBe(false);
  });
});
