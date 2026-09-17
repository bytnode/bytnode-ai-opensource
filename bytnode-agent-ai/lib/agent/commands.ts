/* ---------------------------------------------------------------------------
   Les commandes du champ de saisie.

   Un message qui commence par `/` peut etre une commande. Pendant qu'on la
   tape, le bloc de saisie propose celles qui commencent pareil, avec un mot
   d'explication — pour qui ne sait pas qu'elles existent. Des qu'une espace
   suit le nom, la commande est complete (ce qui suit, ce sont ses
   consignes) et la proposition disparait.

   Pur : la liste et la correspondance. L'execution reste dans
   `use-chat.ts` (`isCompactCommand`).
--------------------------------------------------------------------------- */

export type SlashCommand = {
  /** Le nom, sans la barre : `compact`. */
  name: string;
  /** Ce qui peut suivre, tel qu'on le montre : `[consignes]`. */
  args?: string;
  /** Un mot d'explication, pour la liste. */
  description: string;
};

export const COMMANDS: readonly SlashCommand[] = [
  {
    name: "compact",
    args: "[consignes]",
    description: "Remplacer le fil par un résumé : l'agent garde ce qui compte, la conversation s'allège",
  },
];

/** Les commandes a proposer pour ce qui est tape : `/`, `/c`, `/comp`…
    Rien si le texte ne commence pas par `/`, ou des qu'une espace suit le
    nom — la commande est alors complete. Insensible a la casse. */
export function matchCommands(text: string, commands: readonly SlashCommand[] = COMMANDS): SlashCommand[] {
  const m = text.match(/^\/(\S*)$/);
  if (!m) return [];
  const prefix = m[1].toLowerCase();
  return commands.filter((c) => c.name.startsWith(prefix));
}

/** Le texte est-il une commande connue (`/compact`, `/compact garde…`) ?
    Une commande n'est pas un message : les pieces jointes et la recherche
    approfondie ne la suivent pas. */
export function isCommandText(text: string, commands: readonly SlashCommand[] = COMMANDS): boolean {
  const m = text.trim().match(/^\/(\S+)/);
  return !!m && commands.some((c) => c.name === m[1].toLowerCase());
}

/** Ce que devient le champ quand on complete une commande (Tab) : son nom,
    et une espace pour y ajouter des consignes. */
export const completeCommand = (c: SlashCommand) => `/${c.name} `;

/** Ce qu'on envoie quand on la lance depuis la liste (Entree) : la commande
    seule. */
export const runCommand = (c: SlashCommand) => `/${c.name}`;
