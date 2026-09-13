import type { ExchangeAccount } from "@/lib/domain/types";
import { anyLive, describeAccounts } from "./accounts";

/* La section du prompt qui presente les comptes exchange de l'agent et la
   discipline qui va avec. Partagee : agents OpenRouter (`tools-prompt.ts`)
   et agents par abonnement (`lib/acp/prompt.ts`). Vide sans compte. Pur. */

export function exchangePromptSection(accounts: ExchangeAccount[] | undefined, via: "natif" | "mcp"): string[] {
  if (!accounts?.length) return [];
  const lines = [
    "",
    "## Comptes exchange",
    "",
    `Tu peux agir sur ${accounts.length > 1 ? "ces comptes" : "ce compte"} : ${describeAccounts(accounts)}.${anyLive(accounts) ? " ⚠️ Les comptes marqués RÉEL engagent de l'argent réel." : ""}`,
    via === "mcp"
      ? "Les outils viennent du serveur MCP `bytnode-ai` : ExchangeBalance, ExchangePositions, ExchangeOrders, ExchangeTicker, ExchangeWatch (lecture), PlaceOrder, CancelOrder, ClosePosition, Transfer, SetLeverage (action)."
      : "Outils : ExchangeBalance, ExchangePositions, ExchangeOrders, ExchangeTicker, ExchangeWatch (lecture, sans permission) ; PlaceOrder, CancelOrder, ClosePosition, Transfer, SetLeverage (action, avec permission).",
    "Discipline :",
    "- Avant un ordre : ExchangeBalance puis ExchangeTicker sur l'exchange du compte ; calcule la quantité en actif de base, ou donne `quoteAmount`.",
    "- Un ordre, une fermeture ou un transfert demande TOUJOURS l'accord de l'utilisateur : attends le résultat, ne les enchaîne pas à l'aveugle. Après un ordre, confirme avec ExchangeOrders.",
    "- S'il y a plusieurs comptes, nomme toujours `account`. Précise `market: futures` pour les perpétuels.",
    "- Aucun retrait vers une adresse externe n'existe ; Transfer ne bouge que spot ↔ futures d'un même compte.",
    "- Pour suivre une position dans le temps, ExchangeWatch avec une condition `until` ; il est borné à 10 minutes, relance-le si besoin.",
    "- Charge la compétence `trading-execution` avant de passer un ordre, `trade-review` pour analyser des positions ou un historique.",
  ];
  return lines;
}
