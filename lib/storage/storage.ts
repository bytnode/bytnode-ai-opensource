/* ---------------------------------------------------------------------------
   Ou les donnees vivent. L'interface est volontairement minuscule — trois
   operations sur des chaines — pour qu'un fichier, une base ou un serveur
   puissent la remplacer sans toucher aux depots qui l'utilisent.
--------------------------------------------------------------------------- */

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get(key: string) {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string) {
    this.map.set(key, value);
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
    } catch {
      /* quota ou acces refuse : la donnee ne survivra pas au rechargement */
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
