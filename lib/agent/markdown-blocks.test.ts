import { describe, expect, test } from "vitest";
import { splitBlocks } from "@/components/chat/markdown";

describe("splitBlocks", () => {
  test("splits on blank lines", () => {
    expect(splitBlocks("a\n\nb\n\n\nc")).toEqual(["a", "b", "c"]);
  });

  test("never splits inside a fenced code block", () => {
    const text = "intro\n\n```py\nx = 1\n\ny = 2\n```\n\nfin";
    expect(splitBlocks(text)).toEqual(["intro", "```py\nx = 1\n\ny = 2\n```", "fin"]);
  });

  test("keeps an unterminated fence (still streaming) as one block", () => {
    expect(splitBlocks("a\n\n```\ncode\n\nmore")).toEqual(["a", "```\ncode\n\nmore"]);
  });

  test("keeps list items together", () => {
    expect(splitBlocks("- a\n- b\n\ntexte")).toEqual(["- a\n- b", "texte"]);
  });
});
