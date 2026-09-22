/* ---------------------------------------------------------------------------
   A tiny store for `useSyncExternalStore`.

   ⚠️ LAZY READING IS WHAT MAKES HYDRATION SAFE. The server knows neither
   localStorage nor the settings: it renders with `initial`. In the
   browser, React first reads that same `initial` (via `getServerSnapshot`)
   to hydrate without a mismatch, THEN calls `getSnapshot`, which loads the
   real value exactly once and triggers the client render. No effect, no
   `setState` on mount: this is the mechanism designed for that.
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
