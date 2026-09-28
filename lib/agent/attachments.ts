/* ---------------------------------------------------------------------------
   What gets attached to a message: files, a screenshot, and the deep
   research directive.

   ⚠️ AN ATTACHED FILE IS NOT PASTED INTO THE PROMPT. It is dropped into the
   agent's workspace (`entrees/`), and the message states its path: the
   agent reads it with its tools, can read it again later, load it into
   pandas, plot it. A two-thousand-line CSV thus stays usable, which it
   would not be if it went through the conversation.

   IMAGES are the exception: they are also sent to the model, which has to
   see them to talk about them.

   Pure: shared by browser and server, tested.
--------------------------------------------------------------------------- */

import { BIDI_CONTROLS, WINDOWS_RESERVED } from "@/lib/tools/file-names";

export type AttachmentKind = "image" | "file";

export type Attachment = {
  name: string;
  /** Path relative to the workspace (`entrees/capture-….png`). */
  path: string;
  kind: AttachmentKind;
  size?: number;
  /** For an image: what is needed to show it to the model and in the thread. */
  dataUrl?: string;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

export const isImageName = (name: string) => IMAGE_EXT.test(name);

const MAX_NAME = 80;

/** A file name that can be written to without surprises: no path, no
    forbidden character, never empty, never hidden, bounded — and none of
    what Windows refuses or mangles (`file-names.ts`): a device name
    (`CON`, `NUL.txt`) gets a `_` in front, trailing dots and spaces go, and
    so do the bidi controls that disguise an extension. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = (s: string) => s.replace(/^\.+/, "").trim().replace(/[. ]+$/, "");
  let name = clean(base.replace(/[<>:"|?*\x00-\x1f\x7f]/g, "").replace(BIDI_CONTROLS, ""));
  if (!name) name = `file-${Date.now().toString(36)}`;
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME) {
    const m = name.match(/\.[A-Za-z0-9]{1,8}$/);
    const ext = m ? m[0] : "";
    name = clean(name.slice(0, MAX_NAME - ext.length)) + ext;
  }
  return name;
}

/** The note that tells the agent what is attached, and where. */
export function attachmentNote(attachments: Attachment[]): string {
  if (attachments.length === 0) return "";
  const lignes = attachments.map((a) => `- \`${a.path}\`${a.kind === "image" ? " (image — it is also shown to you)" : ""}`);
  return [
    attachments.length === 1 ? "Attachment, in my workspace:" : "Attachments, in my workspace:",
    ...lignes,
    "Read them with your tools (Read, or pandas for a large CSV) rather than asking me for their content.",
  ].join("\n");
}

export const RESEARCH_DIRECTIVE = [
  "Deep research requested. Follow the `recherche-approfondie` skill:",
  "break the question into sub-questions, run several searches (WebSearch with different phrasings,",
  "WebFetch on the sources that matter, BytNode for any market figure), cross-check at least two independent",
  "sources per claim, date each source, flag disagreements, and end with a sourced synthesis",
  "stating what remains uncertain. Take the time it needs.",
].join(" ");

/** The text sent to the model: the research directive before, the
    attachment note after. What the user typed stays in the middle, intact. */
export function withDirectives(text: string, attachments: Attachment[], research: boolean): string {
  const note = attachmentNote(attachments);
  const corps = text.trim() || (note ? "Look at what I am attaching." : "");
  return [research ? RESEARCH_DIRECTIVE : "", corps, note].filter(Boolean).join("\n\n");
}
