"use client";

import { useRef, useState, type DragEvent } from "react";
import type { ContextFile } from "@/lib/domain/types";
import { newId } from "@/lib/domain/conversation";
import { Close, File } from "@/components/ui/icons";

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

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Props = {
  value: ContextFile[];
  onChange: (files: ContextFile[]) => void;
};

export function ContextFiles({ value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const add = async (list: FileList | File[]) => {
    const files = Array.from(list);
    const accepted: ContextFile[] = [];
    const reasons: string[] = [];
    for (const f of files) {
      if (value.length + accepted.length >= MAX_FILES) {
        reasons.push(`${MAX_FILES} files at most.`);
        break;
      }
      if (!isText(f)) {
        reasons.push(`${f.name}: only text files are read.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        reasons.push(`${f.name} exceeds ${fmtSize(MAX_BYTES)}.`);
        continue;
      }
      accepted.push({ id: newId(), name: f.name, size: f.size, content: await f.text() });
    }
    if (accepted.length) onChange([...value, ...accepted]);
    setRefused(reasons.length ? reasons.join(" ") : null);
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
        <span>Drop text files here, or</span>
        <button type="button" className="cf-browse" onClick={() => input.current?.click()}>
          browse
        </button>
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
                aria-label={`Remove ${f.name}`}
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
