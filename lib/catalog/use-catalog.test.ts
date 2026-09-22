import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@/lib/domain/types";
import { getCatalog, loadAcpModels } from "./use-catalog";

/* The subscription catalog is read again when an agent connects. On a
   cold start, the first read takes a long time (every agent is spawned to
   publish its models) while the agents probed through the protocol (Grok,
   Copilot, Mistral) switch to « connected » in a few seconds: the re-read
   they trigger must not be lost. */

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

  it("replays a load requested while another is in flight", async () => {
    const first = loadAcpModels();
    /* Grok just connected: the catalog asks for a re-read while the first
       one, computed without it, has not come back yet. */
    const second = loadAcpModels();
    expect(pending).toHaveLength(1);

    pending[0].resolve([model("acp:claude/opus")]);
    await first;
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    pending[1].resolve([model("acp:claude/opus"), model("acp:grok/grok-4.6")]);
    await second;
    expect(getCatalog().models.map((m) => m.id)).toContain("acp:grok/grok-4.6");
  });

  it("says a subscription read is in progress until the last replayed one", async () => {
    const first = loadAcpModels();
    expect(getCatalog().acpLoading).toBe(true);
    const second = loadAcpModels();

    pending[0].resolve([]);
    await first;
    /* The first one came back, but the re-read requested in the meantime
       is still to be done: the interface must not conclude « no model ». */
    expect(getCatalog().acpLoading).toBe(true);

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve([model("acp:grok/grok-4.6")]);
    await second;
    expect(getCatalog().acpLoading).toBe(false);
  });
});
