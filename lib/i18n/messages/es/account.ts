import type { Messages } from "../en";

export const account: Messages["account"] = {
  welcome: "Te damos la bienvenida a BytNode-AI",
  lede: "Tus agentes de mercado, en este ordenador. Inicia sesión con tu cuenta de BytNode y estarán listos en un minuto.",
  finishInBrowser: "Termina de iniciar sesión en tu navegador y vuelve aquí.",
  openAgain: "Abrir la página de nuevo",
  settingUp: "Sesión iniciada. Preparando tus agentes…",
  signIn: "Iniciar sesión con el navegador",
  note: "¿Ya has iniciado sesión en bytnode.com? Un clic allí te trae de vuelta. ¿Nuevo en BytNode? Crea una cuenta gratuita en la misma página.",
  signedOut: (reason: string) => `Se ha cerrado tu sesión: ${reason}`,

  keyLimit: "Tu cuenta ya tiene 10 claves de BytNode, así que no se pudo crear ninguna para esta app. Pega una de las tuyas o revoca una en la consola de BytNode.",
  keyFailed: (detail: string) => `No se pudo crear una clave de BytNode para esta app (${detail}). Pega una de las tuyas.`,

  errors: {
    timeout: "El inicio de sesión tardó demasiado. Inténtalo de nuevo.",
    unreachable: (detail: string) => `No se pudo conectar con bytnode.com (${detail}).`,
    cannotWait: (detail: string) => `La app no pudo esperar al navegador (${detail}).`,
    noBrowser: (detail: string) => `No se pudo abrir el navegador (${detail}).`,
    answered: (status: string) => `bytnode.com respondió ${status}.`,
    notSignedIn: "No has iniciado sesión.",
    refused: "Rechazado.",
  },
};
