/* The BytNode account of the desktop app: its sign-in page
   (`components/account/`) and what signing in sets up (`lib/account/`). */
export const account = {
  welcome: "Welcome to BytNode-AI",
  lede: "Your market agents, on this computer. Sign in with your BytNode account and they are ready in a minute.",
  finishInBrowser: "Finish signing in in your browser, then come back here.",
  openAgain: "Open the page again",
  settingUp: "Signed in. Getting your agents ready…",
  signIn: "Sign in with the browser",
  note: "Already signed in on bytnode.com? One click there brings you back. New to BytNode? Create a free account on the same page.",
  signedOut: (reason: string) => `You were signed out: ${reason}`,

  /* The BytNode key made for the app at sign-in, when it could not be. */
  keyLimit: "Your account already has 10 BytNode keys, so none could be made for this app. Paste one of yours, or revoke one in the BytNode console.",
  keyFailed: (detail: string) => `No BytNode key could be made for this app (${detail}). Paste one of yours.`,

  /* The app's own errors while signing in (`desktop/account.ts` writes
     them in English; `accountErrorText` reads them back). What bytnode.com
     answers itself is shown as it comes. */
  errors: {
    timeout: "The sign-in took too long. Try again.",
    unreachable: (detail: string) => `bytnode.com could not be reached (${detail}).`,
    cannotWait: (detail: string) => `The app could not wait for the browser (${detail}).`,
    noBrowser: (detail: string) => `The browser could not be opened (${detail}).`,
    answered: (status: string) => `bytnode.com answered ${status}.`,
    notSignedIn: "Not signed in.",
    refused: "Refused.",
  },
};
