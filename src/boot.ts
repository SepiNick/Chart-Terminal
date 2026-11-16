import { returned } from './oauthcore.ts';   // first: removes a sign-in code from the address bar before anything else runs
// Start-up: offline or server mode, sign-in, bring this browser's localStorage in line with the server (or upload it
// once to an empty server), then load the app. The app itself reads its state from localStorage at start-up.
import { queueState, setServerMode, startSync } from './sync.ts';
import { matchOnSignIn } from './matchui.ts';
import { finishOAuth, takeNotice } from './oauth.ts';
import { toast } from './store.ts';
import { store } from './store.ts';
import { accountMenu, injectStyle, loginScreen, setupScreen } from './login.ts';
import { accountScreen, mustChangeScreen, oauthSignupScreen } from './accountscreens.ts';
import { applyGates, standaloneChip } from './serversui.ts';
import { decideStandalone } from './standalone.ts';
import { recordStatus, setToken, syncServer } from './servers.ts';
import { uploadLocalMedia } from './journal/media.ts';

async function boot() {
  const theme = () => { const t = store.get<{ theme?: string }>('settings', {}).theme; if (t) document.documentElement.dataset.theme = t };
  theme();
  if (returned) { const s = await finishOAuth(returned); if (s) await oauthSignupScreen(s) }   // back from Google / Apple
  const { status: st } = await decideStandalone();   // no server answered => standalone: no sign-in, nothing leaves the device
  if (!st) {
    standaloneChip();
    try { void navigator.storage?.persist?.() } catch {}   // ask the browser not to evict this device's only copy of the data
  } else {
    recordStatus(syncServer().id, st);
    let me = st.user;
    if (!st.loggedIn) setToken(syncServer().id, undefined);   // a stale token
    if (st.mode === 'public') { if (!st.loggedIn) me = await accountScreen(st); if (me?.mustChange) await mustChangeScreen(me.name) }
    else if (st.setup) await setupScreen(); else if (!st.loggedIn) await loginScreen();
    await matchOnSignIn(String(me?.id ?? me?.name ?? st.user?.id ?? st.user?.name ?? 'owner'));   // never overwrites either side silently
    theme();
    setServerMode(true);
    startSync();
    const j = await uploadLocalMedia();   // pictures taken while the server was unreachable
    if (j) queueState('journal', j);
  }
  await import('./main.ts');
  applyGates();
  if (st) accountMenu();
  (window as { __ctPair?: () => void }).__ctPair = () => { if (st) void import('./pairui.ts').then(m => m.openPair()) };   // desktop tray "Pair a phone"
  if (location.hash === '#servers') { history.replaceState(null, '', location.pathname + location.search); void import('./serversui.ts').then(m => m.openServers()) }   // Android menu "Servers…"
  const n = takeNotice(); if (n) toast(n, 5000);
}

boot().catch(e => {
  injectStyle();
  const d = document.createElement('div'); d.className = 'ct-auth';
  d.innerHTML = `<form><h2>Could not start</h2><p class="ct-err"></p><button class="on">Retry</button></form>`;
  d.querySelector('.ct-err')!.textContent = (e as Error).message;
  d.querySelector('form')!.onsubmit = ev => { ev.preventDefault(); location.reload() };
  document.body.append(d);
});
