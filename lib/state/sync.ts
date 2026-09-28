/* ---------------------------------------------------------------------------
   Another tab of the app wrote to storage.

   The browser fires `storage` in every OTHER tab of the same origin when a
   key changes (never in the tab that wrote it), with `key: null` when the
   whole storage was cleared. A store calls this once, when it first loads,
   to re-read what the other tab saved instead of overwriting it later.
   Without a window (server, tests) nothing is listened to.
--------------------------------------------------------------------------- */

export function onStorageChange(key: string, reload: () => void): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === key || e.key === null) reload();
  });
}
