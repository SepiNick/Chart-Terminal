// Browser side of "Continue with Google / Apple" (design §3.1). Redirect flow: store a PKCE verifier, send the user to the
// provider, come back with a one-time code in the URL fragment (removed by oauthcore at start-up), exchange it with the verifier.
import { makePkce, safeProviderUrl, savePending, takePending, ERROR_TEXT, type Returned } from './oauthcore.ts';
import { oauthExchange, oauthStart, type Intent, type Provider } from './oauthapi.ts';
import { syncServer, isSameOrigin } from './servers.ts';
import { toast } from './store.ts';

let flash = '', notice = '';
/** One-shot message for the sign-in screen (sign-in failed / cancelled). */
export const takeFlash = () => { const f = flash; flash = ''; return f };
/** One-shot message to show once the app is up (for example "Google linked"). */
export const takeNotice = () => { const n = notice; notice = ''; return n };

const inApp = () => /\bCTApp\//.test(navigator.userAgent);
const iosStandalone = () => (navigator as { standalone?: boolean }).standalone === true;
/** Buttons only make sense when the page and the server share an origin: the provider sends the user back to the server's origin. */
export const oauthAvailable = () => isSameOrigin(syncServer());

/** Leave for the provider. Resolves never on success (the page navigates away); throws a readable error when it cannot start. */
export async function startOAuth(provider: Provider, intent: Intent = 'login', password?: string): Promise<never> {
  if (iosStandalone()) throw Error('Open this site in Safari to sign in with Google, Apple or Telegram, or use your password.');
  const { verifier, challenge } = await makePkce();
  savePending(localStorage, { verifier, server: syncServer().id, intent });
  const { url } = await oauthStart({ provider, intent, challenge, ret: inApp() ? 'app' : 'web', ...(password ? { password } : {}) });
  const safe = safeProviderUrl(url);
  if (!safe) throw Error('The server returned an invalid sign-in address');
  location.assign(safe);
  return new Promise<never>(() => {});
}

/** Exchange the code from the return. Sets the flash/notice texts; returns the signup ticket when the account must still be created. */
export async function finishOAuth(r: Returned): Promise<{ ticket: string; verifier: string } | null> {
  const p = takePending(localStorage, syncServer().id);
  if (r.error || !r.code) { flash = ERROR_TEXT[r.error ?? 'failed']; return null }
  if (!p) { flash = 'Sign-in was interrupted. Try again.'; return null }
  try {
    const j = await oauthExchange(r.code, p.verifier);
    if ('signup' in j) return { ticket: j.ticket, verifier: p.verifier };
    if ('linked' in j) notice = `${({ apple: 'Apple', telegram: 'Telegram' } as Record<string, string>)[j.linked] ?? 'Google'} account linked`;
  } catch (e) { flash = (e as Error).message || ERROR_TEXT.failed }
  return null;
}

/**
 * Hook for the other return paths (Android custom-scheme intent calls window.__ctOAuth(code); Electron's loopback listener can do the same).
 * Completes the exchange and reloads so the app starts signed in.
 */
export async function receiveOAuthCode(code: string) {
  const r = await finishOAuth({ found: true, code });
  if (r) { toast('This is a new account: create it in the browser first (choose a username), then sign in with the app'); return }
  location.reload();
}
(window as unknown as { __ctOAuth?: typeof receiveOAuthCode }).__ctOAuth = receiveOAuthCode;
