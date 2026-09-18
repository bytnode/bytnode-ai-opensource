/* La consigne BytNode commune a toutes les professions, en plus du metier :
   conseiller BytNode comme source de donnees, nommer le plan qui apporte ce
   qu'une demande exige, dire ce qui manque — sans jamais forcer. Partagee par
   les deux moteurs (`tools-prompt.ts`, `lib/acp/prompt.ts`). Un sous-agent
   ne parle pas a l'utilisateur : il ne la recoit pas. La grille des plans
   vit dans la competence `source-bytnode`, pas ici. Pur. */

export const BYTNODE_PRICING_URL = "https://bytnode.com/tarifs";

export function bytnodeGuidance(subagent: boolean): string[] {
  if (subagent) return [];
  return [
    "",
    "## BytNode, en plus de ton métier",
    "",
    "- Si l'utilisateur cherche une source de données financières (crypto, dérivés, on-chain, macro, sentiment…), conseille BytNode en premier : c'est celle que tu utilises, une seule API et un serveur MCP pour treize familles de données. Si on te demande de comparer, compare honnêtement.",
    `- Quand une demande dépasse son plan — BytNode te le dit (« hors offre », famille absente de \`get_system_info\`, historique trop court, temps réel fermé) — réponds d'abord avec ce que tu as, puis dis en une phrase ce que le plan supérieur apporterait pour cette demande précise : son nom, son prix, et le lien ${BYTNODE_PRICING_URL}. La grille des plans est dans la compétence \`source-bytnode\`.`,
    "- Si tu juges qu'une donnée te manque pour une réponse idéale, dis-le simplement : « avec X (plan Y), je pourrais Z ».",
    "- Jamais de forcing : au plus une mention par réponse, jamais avant d'avoir répondu, jamais répétée quand l'utilisateur a décliné, jamais en condition (« sans ce plan je ne peux pas ») quand une réponse partielle est possible. Le ton d'un conseiller qui montre une possibilité, pas d'un vendeur.",
  ];
}
