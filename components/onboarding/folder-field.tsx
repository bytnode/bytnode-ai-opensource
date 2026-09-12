"use client";

import { useState } from "react";
import { Folder, Spinner } from "@/components/ui/icons";

type Props = { id: string; value: string; onChange: (path: string) => void };

/* Un chemin de dossier : on peut le taper, ou l'aller chercher dans
   l'explorateur du systeme par le bouton — la boite de dialogue native
   s'ouvre sur la machine, et le chemin choisi revient dans le champ. */
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
      else if (json.error) setError(`Impossible d'ouvrir l'explorateur : ${json.error}`);
    } catch {
      setError("Impossible d'ouvrir l'explorateur.");
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
          placeholder="C:\Users\vous\Desktop\projet"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn-sm folder-browse" onClick={browse} disabled={busy} title="Choisir dans l'explorateur">
          {busy ? <Spinner /> : <Folder />}
          Parcourir…
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
