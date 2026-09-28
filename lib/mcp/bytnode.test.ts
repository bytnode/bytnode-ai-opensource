import { describe, expect, it } from "vitest";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describeBytnodeError } from "./bytnode";

/* What the MCP transport really throws: the status in `code`, the raw
   body in the message. */
const httpError = (status: number, body: string) => new StreamableHTTPError(status, `Error POSTing to endpoint: ${body}`);

describe("describeBytnodeError", () => {
  it("a refused key reads as refused — in English, without the JSON body", () => {
    const e = httpError(401, '{"status":"error","timestamp":"2026-09-27T10:00:00Z","detail":"Cle API absente, invalide ou revoquee."}');
    const text = describeBytnodeError(e);
    expect(text).toMatch(/^Key refused by BytNode/);
    expect(text).not.toMatch(/[{}]|Cle|detail/);
    expect(describeBytnodeError(httpError(403, "{}"))).toMatch(/^Key refused/);
  });

  it("a refusal whose status was lost is still recognised from the body", () => {
    expect(describeBytnodeError(new Error('Streamable HTTP error: Error POSTing to endpoint: {"detail":"Cle API absente, invalide ou revoquee."}'))).toMatch(/^Key refused/);
  });

  it("a quota or rate limit, and other statuses, say so without the body", () => {
    expect(describeBytnodeError(httpError(429, '{"detail":"Quota"}'))).toMatch(/rate limit or your plan's quota/);
    const text = describeBytnodeError(httpError(502, "<html>Bad gateway</html>"));
    expect(text).toBe("BytNode answered with an error (HTTP 502). Try again in a moment.");
  });

  it("a network failure is 'unreachable', with the cause", () => {
    expect(describeBytnodeError(new TypeError("fetch failed"))).toBe("BytNode is unreachable: fetch failed");
    expect(describeBytnodeError(new Error('Error POSTing to endpoint: {"a":1}'))).toBe("BytNode is unreachable.");
  });
});
