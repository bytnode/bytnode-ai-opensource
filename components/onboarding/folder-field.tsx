"use client";

import { useState } from "react";
import { Folder, Spinner } from "@/components/ui/icons";

type Props = { id: string; value: string; onChange: (path: string) => void };

/* A folder path: it can be typed, or fetched from the system's file explorer
   through the button — the native dialog opens on the machine, and the chosen
   path comes back into the field. */
export function FolderField({ id, value, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/system/pick-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initial: value || undefined }),
      });
      const json = (await res.json()) as { path: string | null; error: string | null };
      if (json.path) onChange(json.path);
      else if (json.error) setError(`Could not open the file explorer: ${json.error}`);
    } catch {
      setError("Could not open the file explorer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="folder-field">
      <div className="ob-key">
        <input
          id={id}
          className="field-input mono"
          placeholder="Full path of a folder"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn-sm folder-browse" onClick={browse} disabled={busy} title="Choose in the file explorer">
          {busy ? <Spinner /> : <Folder />}
          Browse…
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
