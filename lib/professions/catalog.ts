/* ---------------------------------------------------------------------------
   Les professions : ce qui specialise un agent.

   Quatre metiers, chacun avec son prompt systeme et ses competences, lus
   dans `professions/<id>/` a la racine du projet (voir `load.ts`, serveur
   seulement). Ce fichier-ci ne porte que le catalogue — partage avec le
   navigateur, qui s'en sert pour le choix a la creation de l'agent.
--------------------------------------------------------------------------- */

export type ProfessionId = "standard" | "analyste" | "strategique" | "quantitatif";

export type ProfessionInfo = { id: ProfessionId; label: string; short: string; description: string };

export const PROFESSIONS: ProfessionInfo[] = [
  {
    id: "standard",
    label: "Standard",
    short: "Généraliste",
    description: "Solide sur l'ensemble de la finance et des marchés crypto, sans spécialité. Le bon premier interlocuteur.",
  },
  {
    id: "analyste",
    label: "Analyste",
    short: "Données & tendances",
    description: "Lit les données de marché et le contexte macro, en déduit des tendances et des scénarios, avec un niveau de confiance.",
  },
  {
    id: "strategique",
    label: "Stratégique",
    short: "Stratégies",
    description: "Conçoit des stratégies complètes — objectif, règles d'entrée et de sortie, risque, plan de test — axées crypto, ouvertes aux autres marchés.",
  },
  {
    id: "quantitatif",
    label: "Quantitatif",
    short: "Maths & code",
    description: "Mathématiques, statistiques et Python : modélise, backteste et implémente des algorithmes avec rigueur.",
  },
];

export const DEFAULT_PROFESSION: ProfessionId = "standard";

export const isProfessionId = (v: unknown): v is ProfessionId => PROFESSIONS.some((p) => p.id === v);

export const professionInfo = (id: ProfessionId): ProfessionInfo => PROFESSIONS.find((p) => p.id === id) ?? PROFESSIONS[0];
