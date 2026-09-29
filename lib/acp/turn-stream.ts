import { TurnLogs, type TurnLog } from "./turn-log";
import type { WireEvent } from "./wire";

/* The subscription turns' logs (see `turn-log.ts`), shared by the prompt
   route that writes one and the stream route that reads it again. On
   `globalThis` so a dev reload of one route does not hand the other an
   empty registry. */
const KEY = "__bytnodeAiTurnLogs";
type Holder = { [KEY]?: TurnLogs<WireEvent> };
export const turnLogs: TurnLogs<WireEvent> = ((globalThis as Holder)[KEY] ??= new TurnLogs<WireEvent>());

/** An NDJSON response that reads `log` from `from` on — closing it (the
    user left, the connection broke) stops the reading, never the turn. */
export function ndjsonOf(log: TurnLog<WireEvent>, from: number, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const e of log.follow(from, signal)) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      } catch {
        /* the reader went away */
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" } });
}
