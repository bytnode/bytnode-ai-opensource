/* ---------------------------------------------------------------------------
   Where the data lives. The interface is deliberately tiny — three
   operations on strings — so that a file, a database or a server can
   replace it without touching the repositories that use it.
--------------------------------------------------------------------------- */

export interface Storage {
  get(key: string): string | null;
  /** False if the value could not be written (quota, access refused). */
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get(key: string) {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.map.set(key, value);
    return true;
  }
  remove(key: string) {
    this.map.delete(key);
  }
}

/** `localStorage`, guarded: a browser in private browsing or a quota
    exceeded throws, and the app must not go down over it. */
export class BrowserStorage implements Storage {
  get(key: string) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      /* quota or access refused: it is up to the caller to say so and adapt */
      return false;
    }
  }
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* same */
    }
  }
}
