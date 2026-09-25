"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/* ---------------------------------------------------------------------------
   Markdown that can stand being updated sixty times a second.

   Parsing the whole text on every token gets more and more expensive as the
   reply grows — that is what makes a long reply stutter towards the end. The
   text is therefore split into BLOCKS (separated by a blank line, never
   cutting inside a code block), each block rendered by a memoized component:
   finished blocks no longer change, only the last one — the one being filled
   — is re-parsed.
--------------------------------------------------------------------------- */

export function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "" && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    if (!inFence && line.trim() === "") continue;
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/* A table sits in its own scroller, so it can take the full width as a
   grid of tiles and still scroll sideways when it is wider than the thread. */
const COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} text={b} />
      ))}
    </>
  );
});
