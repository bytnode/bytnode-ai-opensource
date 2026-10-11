import type { Messages } from "../en";

export const account: Messages["account"] = {
  welcome: "Bienvenue dans BytNode-AI",
  lede: "Vos agents de marché, sur cet ordinateur. Connectez-vous avec votre compte BytNode et ils sont prêts en une minute.",
  finishInBrowser: "Terminez la connexion dans votre navigateur, puis revenez ici.",
  openAgain: "Rouvrir la page",
  settingUp: "Connecté. Préparation de vos agents…",
  signIn: "Se connecter via le navigateur",
  note: "Déjà connecté sur bytnode.com ? Un clic là-bas vous ramène ici. Nouveau sur BytNode ? Créez un compte gratuit sur la même page.",
  signedOut: (reason: string) => `Vous avez été déconnecté : ${reason}`,

  keyLimit: "Votre compte a déjà 10 clés BytNode : aucune n'a pu être créée pour cette application. Collez l'une des vôtres, ou révoquez-en une dans la console BytNode.",
  keyFailed: (detail: string) => `Aucune clé BytNode n'a pu être créée pour cette application (${detail}). Collez l'une des vôtres.`,

  errors: {
    timeout: "La connexion a pris trop de temps. Réessayez.",
    unreachable: (detail: string) => `Impossible de joindre bytnode.com (${detail}).`,
    cannotWait: (detail: string) => `L'application n'a pas pu attendre le navigateur (${detail}).`,
    noBrowser: (detail: string) => `Impossible d'ouvrir le navigateur (${detail}).`,
    answered: (status: string) => `bytnode.com a répondu ${status}.`,
    notSignedIn: "Non connecté.",
    refused: "Refusé.",
  },
};
