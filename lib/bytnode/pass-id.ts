/* The name that stands for the app's BytNode credential where the code
   takes a key (`lib/bytnode/app-pass.ts`). Pure, shared browser / server: a
   key that comes from outside (a request, the settings, an environment) is
   passed through `userKey`, so nothing outside can name the credential. */

export const APP_PASS = "bytnode-ai:app-pass";

/** A user's key as given, the credential's name taken out. */
export const userKey = (key: string): string => (key.trim() === APP_PASS ? "" : key);
