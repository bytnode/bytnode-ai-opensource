/* ---------------------------------------------------------------------------
   Ou les donnees vivent. L'interface est volontairement minuscule — trois
   operations sur des chaines — pour qu'un fichier, une base ou un serveur
   puissent la remplacer sans toucher aux depots qui l'utilisent.
--------------------------------------------------------------------------- */

export interface Storage {
  get(key: string): string | null;
  /** Faux si la valeur n'a pas pu etre ecrite (quota, acces refuse). */
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

/** `localStorage`, protege : un navigateur en navigation privee ou un quota
    depasse leve, et l'application ne doit pas tomber pour autant. */
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
      /* quota ou acces refuse : a l'appelant de le dire et de s'adapter */
      return false;
    }
  }
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* idem */
    }
  }
}
