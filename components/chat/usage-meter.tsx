"use client";

import { fmtCost, fmtTokens, usageState } from "@/lib/agent/usage";
import type { UsageInfo } from "@/lib/agent/events";

type Props = {
  usage: UsageInfo | undefined;
  /** Le débit du tour en cours, en jetons par seconde. */
  rate: number | null;
  /** La fenêtre du modèle, quand l'agent ne l'annonce pas lui-même. */
  window: number | null;
  /** Le contexte estimé, utilisé tant qu'aucun décompte exact n'est arrivé
      et pendant qu'une réponse s'écrit. */
  estimate?: number | null;
  streaming: boolean;
};

/* ---------------------------------------------------------------------------
   La jauge, en bas a droite du fil.

   Une ligne, trois informations dans cet ordre de besoin : ou en est la
   fenetre de contexte (c'est elle qui decide quand compacter), a quelle
   vitesse le modele repond, et ce que ca coute. Elle reste discrete tant
   que tout va bien, et passe a l'ambre puis au rouge quand la fenetre se
   remplit.
--------------------------------------------------------------------------- */
export function UsageMeter({
  usage,
  rate,
  window,
  estimate,
  streaming,
}: Props) {
  /* Pendant qu'une réponse s'écrit, le décompte du tour précédent est
     périmé : l'estimation vivante prend le relais. */
  const s = usageState(streaming ? undefined : usage, window, estimate);
  const cost = fmtCost(usage?.cost ?? null);
  if (s.context === null && rate === null && !cost) return null;

  const pct = s.part === null ? null : Math.min(100, Math.round(s.part * 100));
  const titre = [
    s.context !== null
      ? `Contexte ${s.estimated ? "estimé" : "mesuré"} : ${s.context.toLocaleString("fr-FR")} jetons${s.window ? ` sur ${s.window.toLocaleString("fr-FR")}` : ""}`
      : null,
    typeof usage?.input === "number"
      ? `Entrée : ${usage.input.toLocaleString("fr-FR")}`
      : null,
    typeof usage?.output === "number"
      ? `Sortie : ${usage.output.toLocaleString("fr-FR")}`
      : null,
    cost ? `Coût du tour : ${cost}` : null,
    s.provider ? `Fournisseur : ${s.provider}` : null,
    s.level !== "ok"
      ? "La fenêtre se remplit : /compact remplace le fil par un résumé."
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className={`usage usage-${s.level}${streaming ? " is-live" : ""}`}
      title={titre}
      aria-live="off"
    >
      {s.context !== null && (
        <span className="usage-ctx">
          {pct !== null && (
            <span className="usage-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
          {s.estimated ? "~" : ""}
          {fmtTokens(s.context)}
          {s.window ? ` / ${fmtTokens(s.window)}` : ""}
          {pct !== null ? ` · ${pct} %` : ""}
        </span>
      )}
      {rate !== null && <span className="usage-rate">{rate} tok/s</span>}
      {cost && <span className="usage-cost">{cost}</span>}
    </div>
  );
}
