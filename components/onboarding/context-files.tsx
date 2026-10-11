"use client";

import { useRef, useState, type DragEvent } from "react";
import type { ContextFile } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
import { Close, File } from "@/components/ui/icons";
import { currentMessages } from "@/lib/i18n/store";
import { useMessages } from "@/lib/i18n/react";

/* ---------------------------------------------------------------------------
   The context files.

   They are read here, once, and kept as text in the settings: that is what
   lets the agent receive them in every conversation without having to drop
   them again. The trade-off is the room in localStorage — hence the per-file
   limit, and the refusal of binary formats (a PDF is not text, it would have
   to be extracted).
--------------------------------------------------------------------------- */

const MAX_BYTES = 200 * 1024;
const MAX_FILES = 12;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "yaml", "yml", "xml", "html", "css", "js", "jsx", "ts", "tsx",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "sh", "sql", "toml", "ini", "env", "log", "rst",
]);

const isText = (f: globalThis.File) => {
  if (f.type.startsWith("text/") || f.type === "application/json") return true;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
};

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Reads the files that can be kept as context, and says why the others
    were refused, in the interface's language at the time of the drop.
    Shared with the agent's page. */
export async function readContextFiles(list: FileList | File[], have: number): Promise<{ accepted: ContextFile[]; refused: string | null }> {
  const accepted: ContextFile[] = [];
  const reasons: string[] = [];
  const t = currentMessages().onboarding.files;
  for (const f of Array.from(list)) {
    if (have + accepted.length >= MAX_FILES) {
      reasons.push(t.maxFiles(MAX_FILES));
      break;
    }
    if (!isText(f)) {
      reasons.push(t.notText(f.name));
      continue;
    }
    if (f.size > MAX_BYTES) {
      reasons.push(t.tooBig(f.name, fmtSize(MAX_BYTES)));
      continue;
    }
    accepted.push({ id: newId(), name: f.name, size: f.size, content: await f.text() });
  }
  return { accepted, refused: reasons.length ? reasons.join(" ") : null };
}

type Props = {
  value: ContextFile[];
  onChange: (files: ContextFile[]) => void;
};

export function ContextFiles({ value, onChange }: Props) {
  const t = useMessages().onboarding.files;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const add = async (list: FileList | File[]) => {
    const { accepted, refused: why } = await readContextFiles(list, value.length);
    if (accepted.length) onChange([...value, ...accepted]);
    setRefused(why);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void add(e.dataTransfer.files);
  };

  return (
    <div className="cf">
      <div
        className={`cf-drop${over ? " is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {t.drop(
          <button type="button" className="cf-browse" onClick={() => input.current?.click()}>
            {t.browse}
          </button>,
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {refused && (
        <p className="field-error" role="alert">
          {refused}
        </p>
      )}
      {value.length > 0 && (
        <ul className="cf-list">
          {value.map((f) => (
            <li key={f.id} className="cf-item">
              <File />
              <span className="cf-name">{f.name}</span>
              <span className="cf-size mono">{fmtSize(f.size)}</span>
              <button
                type="button"
                className="cf-remove"
                onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                aria-label={t.remove(f.name)}
              >
                <Close />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
