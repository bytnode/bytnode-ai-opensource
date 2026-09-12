"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ---------------------------------------------------------------------------
   Du markdown qui supporte d'etre mis a jour soixante fois par seconde.

   Parser tout le texte a chaque jeton coute de plus en plus cher a mesure
   que la reponse s'allonge — c'est ce qui fait saccader une longue reponse
   vers la fin. Le texte est donc decoupe en BLOCS (separes par une ligne
   vide, sans couper a l'interieur d'un bloc de code), chaque bloc rendu par
   un composant memorise : les blocs acheves ne changent plus, seul le
   dernier — celui qui se remplit — est re-parse.
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

const Block = memo(function Block({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
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
