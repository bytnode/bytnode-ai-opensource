import type { ReactNode } from "react";
import type { Messages } from "../en";

export const chat: Messages["chat"] = {
  /* The page and its header. */
  newConversation: "Nueva conversación",
  yourAgent: "Tu agente",
  unnamed: "Sin nombre",
  agent: "Agente",
  agents: "Agentes",
  conversations: "Conversaciones",
  showColumn: "Mostrar la columna",
  closeMenu: "Cerrar el menú",
  exchangeAccounts: (list: string) => `Cuentas de exchange: ${list}`,
  foot: "El agente puede equivocarse. Comprueba lo importante.",
  storageFull:
    "El almacenamiento del navegador está lleno: lo que ves no sobrevivirá a una recarga. Elimina conversaciones antiguas o compacta esta (/compact).",
  compactFailed: (message: string) => `No se pudo compactar: ${message}`,
  retry: "Reintentar",
  deleteAgentTitle: (name: string) => `¿Eliminar ${name}?`,
  deleteAgentBody: (conversations: number) =>
    conversations === 0
      ? "Se eliminarán el agente y su configuración. Esta acción no se puede deshacer."
      : conversations === 1
        ? "Se eliminarán el agente, su configuración y su conversación. Esta acción no se puede deshacer."
        : `Se eliminarán el agente, su configuración y sus ${conversations} conversaciones. Esta acción no se puede deshacer.`,

  /* Our two permission modes, for an agent on OpenRouter. */
  modes: {
    ask: { name: "Preguntar antes de actuar", description: "Cada comando y cada cambio en un archivo espera tu permiso." },
    skip: { name: "Ejecución directa", description: "Cada herramienta se ejecuta sin preguntar." },
  },

  /* No access to the models: the composer's line and its way out. */
  locked: {
    noKey: "Aún no hay clave de OpenRouter.",
    needsInstall: (agent: string) => `Hay que volver a instalar ${agent}.`,
    notSignedIn: (agent: string) => `No has iniciado sesión en ${agent}.`,
    addKey: "Añadir una clave",
    install: (agent: string) => `Instalar ${agent}`,
    signIn: (agent: string) => `Iniciar sesión en ${agent}`,
  },

  /* The thread. */
  hello: (name: string) => `Hola, ${name}.`,
  helloAnon: "Hola.",
  listening: (agent: string) => `${agent} te escucha.`,
  welcome: (name: string) => `Te damos la bienvenida, ${name}.`,
  welcomeAnon: "Te damos la bienvenida.",
  welcomeSub: "Tu primer agente está listo. Esto es lo que podemos hacer juntos.",
  jumpToBottom: "Ir al final",
  followReply: "Seguir la respuesta",

  /* A message. */
  deepResearch: "Investigación a fondo",
  compacting: "Compactando la conversación…",
  compactingHint: "el agente resume lo importante y luego el resumen sustituye a la conversación",
  agentWriting: "El agente está escribiendo",
  agentWorking: "El agente está trabajando",
  commandRan: (command: ReactNode) => <>{command} se ejecutó — nada que mostrar.</>,
  stopped: "Detenida",
  continue: "Continuar",
  viewSummary: "ver el resumen",
  hideSummary: "ocultar el resumen",
  plan: "Plan",
  compacted: "Conversación compactada",
  compactedAuto: "Conversación compactada automáticamente — ventana llena",
  compactedOverflow: "Conversación compactada automáticamente — contexto superado",

  /* A tool call, a workflow's sub-agents, the permission prompt. */
  tool: {
    task: (n: number) => `Tarea ${n}`,
    hide: "ocultar",
    follow: "seguir",
    viewReport: "ver el informe",
    viewSteps: "ver los pasos",
    thinking: "Pensando — aún no ha usado ninguna herramienta.",
    commitsFunds: "Esta acción compromete fondos. Permítela una sola vez, con conocimiento de causa.",
    irreversible: "Este comando es irreversible. Permítelo una sola vez, con conocimiento de causa.",
    wantsTool: "El agente quiere usar esta herramienta.",
    allow: "Permitir",
    deny: "Denegar",
    remembered: (rule: string) => `Este permiso se recordará para este agente: ${rule}`,
    alwaysAllow: (tool: string) => `Permitir siempre ${tool}`,
    alwaysAllowCommand: (command: string) => `Permitir siempre «${command} …»`,
  },

  /* The composer. */
  composer: {
    placeholder: "Escribe tu mensaje…  (/ para los comandos)",
    placeholderLocked: "Conecta un acceso a los modelos para escribir.",
    reply: "Responder…",
    howCanIHelp: "¿En qué puedo ayudarte?",
    howCanIHelpToday: "¿En qué puedo ayudarte hoy?",
    yourMessage: "Tu mensaje",
    commands: "Comandos",
    keyChoose: "elegir",
    keyComplete: "completar",
    keyRun: "ejecutar",
    keyClose: "cerrar",
    removeResearch: "Quitar la investigación a fondo",
    remove: (name: string) => `Quitar ${name}`,
    addTitle: "Añadir archivos, una captura de pantalla, una investigación a fondo",
    addToMessage: "Añadir al mensaje",
    addFiles: "Añadir archivos",
    addFilesHint: "Se guardan en el espacio de trabajo del agente",
    screenshot: "Hacer una captura de pantalla",
    screenshotHint: "Tú eliges la pantalla o la ventana",
    researchOn: "Activada para el próximo mensaje",
    researchHint: "Varias fuentes, contrastadas y fechadas",
    stopReply: "Detener la respuesta",
    send: "Enviar",
    sendTitle: "Enviar (Intro)",
    /* BytNode-AI's own commands, by name (an agent's own keep its words). */
    own: {
      compact: {
        args: "[instrucciones]",
        description: "Sustituye la conversación por un resumen: el agente conserva lo importante y la conversación se aligera",
      },
    },
  },

  /* The conversation's settings (the composer's chip). */
  picker: {
    settings: "Ajustes",
    conversationSettings: "Ajustes de la conversación",
    chipLabel: (model: string, effort: string | null) =>
      effort ? `Ajustes de la conversación: ${model}, esfuerzo ${effort}` : `Ajustes de la conversación: ${model}`,
    backToSettings: "Volver a los ajustes",
    model: "Modelo",
    effort: "Esfuerzo",
    mode: "Modo",
    profession: "Perfil",
    chooseModel: "Elige un modelo",
    doesNotReason: "No razona",
    default: "Predeterminado",
    noReasoning: "Sin razonamiento",
    searchModelsOf: (agent: string) => `Buscar modelos de ${agent}`,
    searchAllModels: "Buscar en todos los modelos",
    searchModel: "Buscar un modelo",
    readingCatalog: "Leyendo el catálogo…",
    readingSubscription: (agent: string) => `Leyendo los modelos de tu suscripción a ${agent}…`,
    reload: "Recargar",
    noMatch: (query: string) => `Ningún modelo coincide con «${query}».`,
    providerEmpty: "Este proveedor no tiene ningún modelo.",
    yourSubscription: (agent: string) => `Tu suscripción a ${agent}`,
    latestReleases: "Últimos lanzamientos",
  },

  /* The effort levels, as named on screen. */
  efforts: {
    max: "Máximo",
    xhigh: "Muy alto",
    high: "Alto",
    medium: "Medio",
    low: "Bajo",
    minimal: "Mínimo",
    none: "Ninguno",
  },

  /* The meter, bottom right. */
  usage: {
    context: (estimated: boolean, tokens: string, window: string | null) =>
      `Contexto ${estimated ? "estimado" : "medido"}: ${tokens} tokens${window ? ` de ${window}` : ""}`,
    input: (tokens: string) => `Entrada: ${tokens}`,
    output: (tokens: string) => `Salida: ${tokens}`,
    cost: (cost: string) => `Coste del turno: ${cost}`,
    provider: (provider: string) => `Proveedor: ${provider}`,
    filling: "La ventana se está llenando: /compact sustituye la conversación por un resumen.",
  },

  /* The left column. */
  sidebar: {
    label: "Agentes y conversaciones",
    collapse: "Contraer la columna",
    newAgent: "Nuevo agente",
    empty: "Crea un primer agente para empezar.",
    you: "Tú",
    accountSettings: "Ajustes de la cuenta",
    scheduled: "Tareas programadas",
    scheduledEmpty: "Los informes de tus tareas programadas llegarán aquí, una carpeta por tarea.",
    taskOf: (task: string, agent: string) => `${task} — tarea programada de ${agent}`,
    showLess: "Mostrar menos",
    showAll: "Mostrar todo",
    showAllCount: (n: number) => `Mostrar todo (${n})`,
    hideConversationsOf: (agent: string) => `Ocultar las conversaciones de ${agent}`,
    showConversationsOf: (agent: string) => `Mostrar las conversaciones de ${agent}`,
    hideConversations: "Ocultar las conversaciones",
    showConversations: "Mostrar las conversaciones",
    optionsFor: (agent: string) => `Opciones de ${agent}`,
    optionsForConversation: (title: string) => `Opciones de «${title}»`,
    editAgent: "Editar el agente",
    newTitle: "Nuevo título",
    report: (title: string, agent: string | null) =>
      agent ? `${title} — informe de una tarea programada, de ${agent}` : `${title} — informe de una tarea programada`,
  },

  /* An agent's page. */
  page: {
    subscription: (agent: string) => `Suscripción a ${agent}`,
    empty: (agent: string) => `Nada por ahora. Escribe arriba para empezar la primera conversación con ${agent}.`,
    about: "Acerca de este agente",
    recent: "Recientes",
    thisWeek: "Esta semana",
    earlier: "Anteriores",
    overview: "Resumen",
    thisWeekCount: (n: number) => `${n} esta semana`,
    noneThisWeek: "ninguna esta semana",
    lastActive: "Última actividad",
    neverYet: "todavía ninguna",
    messages: "Mensajes",
    inDays: (days: number) => ` en ${days} días`,
    options: "Opciones del agente",
    deleteAgent: "Eliminar el agente",
    instructions: "Instrucciones",
    editInstructions: "Editar las instrucciones",
    addInstructions: "Añadir instrucciones",
    instructionsPlaceholder: "Eres el asistente de … Responde en …",
    instructionsEmpty:
      "Ajusta las respuestas de este agente: lo que debe saber y cómo debe responder. Se envía al inicio de cada conversación.",
    context: "Contexto",
    addReferenceFiles: "Añadir archivos de referencia",
    addFiles: "Añadir archivos",
    dropHint:
      "Suelta aquí documentos de texto — notas, CSV, Markdown, código — para que este agente los use como referencia en cada conversación.",
  },

  /* The floating agent, over the plugins' tabs. */
  floating: {
    conversationWith: (agent: string) => `Conversación con ${agent}`,
    switch: "Cambiar de agente o de conversación",
    empty: "Aún no hay ninguna conversación.",
    expand: "Abrir en Conversaciones",
    closeConversationWith: (agent: string) => `Cerrar la conversación con ${agent}`,
    talkTo: (agent: string) => `Hablar con ${agent}`,
    waiting: (agent: string) => `${agent} espera tu permiso`,
    writing: (agent: string) => `${agent} está escribiendo`,
  },

  /* What went wrong, as the thread (or the screen that asked) says it. */
  errors: {
    interrupted: "La respuesta se interrumpió. Comprueba tu conexión.",
    noSummary: "El agente no produjo ningún resumen.",
    withCompactHint: (why: string) => `${why} Escribe /compact para resumir la conversación, o abre una nueva.`,
    contextFullStopped:
      "La ventana de contexto está llena y se detuvo la compactación de la conversación. Escribe /compact para resumir la conversación, o abre una nueva.",
    contextFullFailed: (error: string | null) =>
      `La ventana de contexto está llena y la compactación de la conversación falló: ${error ?? "el agente no produjo ningún resumen."} Escribe /compact para resumir la conversación, o abre una nueva.`,
    exceededMidTask: "Se superó la ventana de contexto en mitad de la tarea: la conversación se compacta y luego la tarea continúa.",
    keyRefused: (message: string) => `Clave de OpenRouter rechazada (${message}) — revísala en los ajustes.`,
    providerAnswered: (status: number) => `El proveedor respondió ${status}.`,
    serverAnswered: (status: number) => `El servidor respondió ${status}.`,
    uploadFailed: (status: number) => `No se pudo subir (${status}).`,
    catalogUnavailable: "Catálogo no disponible.",
    subscriptionStatusUnavailable: "Estado de la suscripción no disponible.",
    couldNotSignIn: "No se pudo iniciar sesión.",
    codeNotSent: "No se pudo enviar el código.",
    couldNotInstall: "No se pudo instalar.",
    couldNotSignOut: "No se pudo cerrar sesión.",
    captureUnsupported: "Este navegador no puede capturar la pantalla.",
    captureBlockedMac:
      "macOS bloqueó la captura: permite tu navegador en Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla y audio del sistema, y luego reinicia el navegador.",
    captureEmpty: "La pantalla compartida no mostró nada.",
    imagePrepare: "No se pudo preparar la imagen.",
    imageEncode: "No se pudo codificar la imagen.",
    retrying: (reason: string, attempt: number, of: number) => `${reason} — reintentando ${attempt}/${of}…`,
  },
};
