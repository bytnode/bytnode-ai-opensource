import { describe, expect, test } from "vitest";
import { createSseParser, extractDelta } from "./sse";

describe("createSseParser", () => {
  test("yields the payload of each data line", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  test("buffers a line split across two chunks", () => {
    const p = createSseParser();
    expect(p.feed('data: {"a":')).toEqual([]);
    expect(p.feed('1}\n\n')).toEqual(['{"a":1}']);
  });

  test("ignores comment lines and blank lines", () => {
    const p = createSseParser();
    expect(p.feed(": OPENROUTER PROCESSING\n\ndata: x\n\n")).toEqual(["x"]);
  });

  test("reports [DONE] as the end of the stream", () => {
    const p = createSseParser();
    expect(p.feed("data: x\n\ndata: [DONE]\n\n")).toEqual(["x"]);
    expect(p.done).toBe(true);
  });

  test("accepts CRLF line endings", () => {
    const p = createSseParser();
    expect(p.feed("data: x\r\n\r\n")).toEqual(["x"]);
  });
});

describe("extractDelta", () => {
  test("returns the text delta of a chat completion chunk", () => {
    expect(extractDelta('{"choices":[{"delta":{"content":"Bon"}}]}')).toEqual({ text: "Bon" });
  });

  test("returns an empty text when the chunk carries no content", () => {
    expect(extractDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toEqual({ text: "" });
  });

  test("surfaces an error object sent mid-stream", () => {
    expect(extractDelta('{"error":{"message":"Rate limited","code":429}}')).toEqual({
      text: "",
      error: "Rate limited",
    });
  });

  test("tolerates malformed json", () => {
    expect(extractDelta("{not json")).toEqual({ text: "" });
  });
});
