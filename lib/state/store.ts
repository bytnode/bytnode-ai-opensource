/* ---------------------------------------------------------------------------
   Un magasin minuscule pour `useSyncExternalStore`.

   ⚠️ LA LECTURE PARESSEUSE EST CE QUI REND L'HYDRATATION SURE. Le serveur ne
   connait ni localStorage ni les reglages : il rend avec `initial`. Dans le
   navigateur, React lit d'abord le meme `initial` (via `getServerSnapshot`)
   pour hydrater sans desaccord, PUIS appelle `getSnapshot`, qui charge la
   vraie valeur une seule fois et provoque le rendu client. Aucun effet, aucun
   `setState` au montage : c'est le mecanisme prevu pour cela.
--------------------------------------------------------------------------- */

export type Store<T> = {
  get(): T;
  getServer(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T, load?: () => T): Store<T> {
  let state = initial;
  let loaded = load === undefined;
  const listeners = new Set<() => void>();
  return {
    get() {
      if (!loaded && typeof window !== "undefined") {
        loaded = true;
        state = load!();
      }
      return state;
    },
    getServer: () => initial,
    set(next) {
      state = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      loaded = true;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
