// Start-up: offline or server mode, sign-in, bring this browser's localStorage in line with the server (or upload it
// once to an empty server), then load the app. The app itself reads its state from localStorage at start-up.
import { api, hydrate, localKeys, localSnapshot, queueState, setServerMode, startSync, type ServerState } from './sync.ts';
import { store } from './store.ts';
import { accountMenu, dialog, injectStyle, loginScreen, setupScreen } from './login.ts';
import { accountScreen, mustChangeScreen } from './accountscreens.ts';
import { applyGates, standaloneChip } from './serversui.ts';
import { decideStandalone } from './standalone.ts';
import { recordStatus, setToken, syncServer } from './servers.ts';
import { uploadLocalMedia } from './journal/media.ts';

function downloadBackup() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(localSnapshot(), null, 1)], { type: 'application/json' }));
  a.download = `chart-terminal-browser-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
async function upload(progress: (t: string) => void) {
  await uploadLocalMedia((i, n) => progress(`Uploading pictures and voice notes… ${i + 1}/${n}`));   // rewrites ids in ct.journal
  const all = Object.entries(localSnapshot());
  for (const [i, [k, value]] of all.entries()) { progress(`Uploading ${i + 1}/${all.length}…`); await api(`/api/state/${k}`, { method: 'PUT', body: { value } }) }
}
/** First sign-in against an empty server while this browser has data: upload it, or start empty. */
function offerUpload(): Promise<void> {
  return new Promise(res => dialog('Upload this browser’s data?', `
    <p>The server has no data yet. This browser has ${localKeys().length} saved items — layouts, drawings, watchlists, scripts, settings,
      the paper account and the journal with its pictures and voice notes.</p>
    <p>Upload them so every device you sign in on sees the same data? If you start empty, the copy in this browser is replaced
      by the empty server data (the backup file keeps everything except pictures and voice notes).</p>
    <p class="muted" data-msg></p>
    <div class="row wrap"><button type="button" data-a="backup">Download backup</button><span class="grow"></span>
      <button type="button" data-a="empty">Start empty</button><button type="button" data-a="up" class="on">Upload</button></div>`, (f, close) => {
    const msg = f.querySelector<HTMLElement>('[data-msg]')!, btns = [...f.querySelectorAll<HTMLButtonElement>('button')];
    f.onclick = async e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'backup') downloadBackup();
      if (a === 'empty' && confirm('Replace the data in this browser with the empty server data?')) { close(); res() }
      if (a !== 'up') return;
      btns.forEach(b => (b.disabled = true)); msg.className = 'muted';
      try { await upload(t => (msg.textContent = t)); close(); res() }
      catch (x) { msg.className = 'ct-err'; msg.textContent = `Upload failed: ${(x as Error).message}. Try again.`; btns.forEach(b => (b.disabled = false)) }
    };
  }, false));
}

async function boot() {
  const theme = () => { const t = store.get<{ theme?: string }>('settings', {}).theme; if (t) document.documentElement.dataset.theme = t };
  theme();
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
    let state = await api<ServerState>('/api/state');
    if (!Object.keys(state).length && localKeys().length) { await offerUpload(); state = await api<ServerState>('/api/state') }
    hydrate(state); theme();
    setServerMode(true);
    startSync();
    const j = await uploadLocalMedia();   // pictures taken while the server was unreachable
    if (j) queueState('journal', j);
  }
  await import('./main.ts');
  applyGates();
  if (st) accountMenu();
}

boot().catch(e => {
  injectStyle();
  const d = document.createElement('div'); d.className = 'ct-auth';
  d.innerHTML = `<form><h2>Could not start</h2><p class="ct-err"></p><button class="on">Retry</button></form>`;
  d.querySelector('.ct-err')!.textContent = (e as Error).message;
  d.querySelector('form')!.onsubmit = ev => { ev.preventDefault(); location.reload() };
  document.body.append(d);
});
