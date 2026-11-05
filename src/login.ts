// Sign-in screens (first password, login) and the account menu in the top bar. Built at runtime so index.html stays
// the app's markup; styled with the app's CSS variables.
import { api, clearSynced, downloadBackup, flushNow, onSyncStatus, type SyncStatus } from './sync.ts';
import { deviceLabel, gate, isSameOrigin, setToken, syncServer } from './servers.ts';
import { releasePushOnServer } from './push.ts';
import { esc, toast } from './store.ts';
import { codesOf } from './authrules.ts';
import { openServers } from './serversui.ts';

const CSS = `
.ct-auth{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:16px}
.ct-auth form{width:min(380px,100%);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:22px;display:flex;flex-direction:column;gap:10px}
.ct-auth h2{margin:0;font-size:18px}.ct-auth p{margin:0;line-height:1.5}
.ct-auth input,.ct-dlg input{font:inherit;font-size:14px;padding:8px 10px;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:6px}
.ct-auth button{font-size:14px;padding:8px}
.ct-err{color:var(--down);min-height:1.4em}.ct-err:empty{min-height:0}
.ct-warn{border-left:3px solid var(--accent);padding-left:8px}
.ct-dlg .form{grid-template-columns:auto 1fr}.ct-dlg table{width:100%;border-collapse:collapse}.ct-dlg td,.ct-dlg th{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);vertical-align:top}
#acctBtn{position:relative}#acctBtn i{position:absolute;right:3px;top:3px;width:7px;height:7px;border-radius:50%;background:var(--up)}
#acctBtn i.saving{background:var(--accent)}#acctBtn i.offline{background:var(--down)}
.ct-banner{position:fixed;left:8px;bottom:8px;z-index:70;background:var(--panel);color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:11px}
.ct-banner button{border:0;background:none;color:inherit;padding:0 0 0 6px}
#standaloneChip{left:56px;max-width:calc(100vw - 64px);display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px}#standaloneChip button{padding:0;text-decoration:underline;color:var(--accent)}`;
let styled = false;
export function injectStyle() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s) }

const isThisPc = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Full-screen form; resolves when `submit` resolves (errors from it are shown under the inputs). */
export function screen(html: string, submit: (f: HTMLFormElement) => Promise<void>, extra = '', btnLabel = 'Continue'): Promise<string> {
  injectStyle();
  const wrap = document.createElement('div'); wrap.className = 'ct-auth';
  wrap.innerHTML = `<form novalidate>${html}<div class="ct-err" role="alert"></div><button class="on">${btnLabel}</button>${extra}</form>`;
  document.body.append(wrap);
  const f = wrap.querySelector('form')!, err = f.querySelector('.ct-err')!, btn = f.querySelector<HTMLButtonElement>('button.on')!;
  f.querySelector<HTMLInputElement>('input')?.focus();
  return new Promise(res => {
    f.onclick = e => { const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go; if (go) { e.preventDefault(); wrap.remove(); res(go) } };
    f.onsubmit = async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try { await submit(f); wrap.remove(); res('done') } catch (x) { err.textContent = (x as Error).message } finally { btn.disabled = false }
    };
  });
}
export const val = (f: HTMLFormElement, name: string) => (f.elements.namedItem(name) as HTMLInputElement).value;

export function setupScreen() {
  return screen(`<h2>Set a password</h2>
    <p>This server is new. Choose the password that every device (this PC, your phone, other computers) will use to sign in.</p>
    <p class="muted ct-warn">For safety the first password can only be set on the computer that runs the server.${isThisPc() ? '' : '<br><b>You are on another device</b> — open the app on the server PC to set the password, then sign in here.'}</p>
    <input type="password" name="pw" placeholder="Password (at least 8 characters)" autocomplete="new-password">
    <input type="password" name="pw2" placeholder="Repeat the password" autocomplete="new-password">`, async f => {
    const pw = val(f, 'pw');
    if (pw.length < 8) throw Error('Use at least 8 characters');
    if (pw !== val(f, 'pw2')) throw Error('The passwords don’t match');
    await api('/api/auth/setup', { body: { password: pw } });
  });
}

/** Auth call; on a server other than the one serving the page it asks for a device token (no cookie) and keeps it. */
export async function authPost<T = { ok: true }>(path: string, body: Record<string, unknown>): Promise<T> {
  const s = syncServer(), remote = !isSameOrigin(s);
  const j = await api<T & { token?: string }>(path, { body: remote ? { ...body, device: deviceLabel() } : body });
  if (remote && j.token) setToken(s.id, j.token);
  return j;
}

export function loginScreen() {
  return screen(`<h2>Chart Terminal</h2><p class="muted">Sign in to your server.</p>
    <input type="password" name="pw" placeholder="Password" autocomplete="current-password">`, async f => {
    const pw = val(f, 'pw'); if (!pw) throw Error('Enter your password');
    await authPost('/api/auth/login', { password: pw });   // the server's message covers wrong password and lockout
  });
}

/** Modal dialog built from HTML; `wire` gets the form and a close function. Escape doesn't close it unless `escapable`. */
export function dialog(title: string, html: string, wire: (f: HTMLFormElement, close: () => void) => void, escapable = true) {
  injectStyle();
  const d = document.createElement('dialog'); d.className = 'ct-dlg';
  d.innerHTML = `<form method="dialog" novalidate><h3>${esc(title)}</h3>${html}</form>`;
  document.body.append(d);
  const close = () => { d.close(); d.remove() };
  d.addEventListener('cancel', e => { e.preventDefault(); if (escapable) close() });
  wire(d.querySelector('form')!, close);
  d.showModal();
}

// ---------- account menu ----------
const LABEL: Record<SyncStatus, string> = { synced: 'All changes saved on the server', saving: 'Saving…', offline: 'Not connected — changes are kept and sent when the server is back' };
export function accountMenu() {
  injectStyle();
  const top = document.getElementById('top'); if (!top || document.getElementById('acctBtn')) return;
  const b = document.createElement('button'); b.id = 'acctBtn'; b.innerHTML = '👤<i></i>';
  top.insertBefore(b, document.getElementById('settingsBtn'));
  let st: SyncStatus = 'synced';
  onSyncStatus(s => { st = s; b.querySelector('i')!.className = s; b.title = `Account · ${LABEL[s]}` });
  b.onclick = e => {
    e.stopPropagation();
    document.querySelector('.ct-acct')?.remove();
    const m = document.createElement('div'); m.className = 'ctx ct-acct';
    const r = b.getBoundingClientRect();
    m.style.top = `${r.bottom + 4}px`; m.style.right = `${Math.max(4, innerWidth - r.right)}px`;
    m.innerHTML = `<div class="ctx-i muted" style="pointer-events:none">Signed in · ${esc(LABEL[st])}</div><hr>
      ${gate('trading').on ? '<div class="ctx-i" data-a="accts">Exchange accounts…</div>' : ''}<div class="ctx-i" data-a="sessions">Devices &amp; sessions…</div><div class="ctx-i" data-a="shares">Shared links…</div><div class="ctx-i" data-a="password">Change password…</div>${syncServer().mode === 'public' ? '<div class="ctx-i" data-a="methods">Sign-in methods…</div><div class="ctx-i" data-a="codes">New recovery codes…</div>' : ''}<div class="ctx-i" data-a="restore">Restore points…</div><div class="ctx-i" data-a="servers">Servers…</div><hr>
      <div class="ctx-i" data-a="logout">Log out</div>`;
    document.body.append(m);
    const off = () => { m.remove(); removeEventListener('pointerdown', out, true) };
    const out = (ev: Event) => { if (!m.contains(ev.target as Node)) off() };
    addEventListener('pointerdown', out, true);
    m.onclick = ev => {
      const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a; if (!a) return;
      off();
      if (a === 'accts' && !document.getElementById('s-accts')?.classList.contains('on')) document.querySelector<HTMLElement>('#rail [data-side="accts"]')?.click();   // accounts
      if (a === 'sessions') void sessions();
      if (a === 'shares') void shares();
      if (a === 'password') changePassword();
      if (a === 'servers') openServers();
      if (a === 'codes') newCodes();
      if (a === 'methods') void import('./signinmethods.ts').then(m => m.signInMethods());
      if (a === 'restore') void import('./matchui.ts').then(m => m.restorePoints());
      if (a === 'logout') void logout();
    };
  };
}
async function logout() {
  if (!(await flushNow())) {   // some edits never reached the server: do not clear them without a copy
    if (!confirm('Some recent changes could not be saved on the server. Log out anyway? A backup file of this browser will be downloaded first.')) return;
    downloadBackup();
  }
  const s = syncServer();
  if (s.mode === 'public') await releasePushOnServer().catch(() => {});   // someone else may sign in on this browser next
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  setToken(s.id, undefined);
  if (s.mode === 'public') clearSynced();   // the next person on this browser must not inherit (or upload) this account's data
  location.reload();
}
function newCodes() {
  dialog('New recovery codes', `<p class="muted">The old codes stop working. Enter your password to get a fresh set.</p>
    <div class="form"><label>Password</label><input type="password" name="pw" autocomplete="current-password"></div>
    <div class="ct-err"></div><div class="row"><span class="grow"></span><button type="button" data-x>Cancel</button><button class="on">Create</button></div>`, (f, close) => {
    f.querySelector<HTMLButtonElement>('[data-x]')!.onclick = close;
    f.onsubmit = async e => {
      e.preventDefault();
      try { const j = await api('/api/auth/recovery-codes', { body: { password: val(f, 'pw') } }); close(); const { recoveryCodesScreen } = await import('./accountscreens.ts'); await recoveryCodesScreen(codesOf(j), ''); }
      catch (x) { f.querySelector('.ct-err')!.textContent = (x as Error).message }
    };
  });
}
function changePassword() {
  dialog('Change password', `<div class="form">
      <label>Current password</label><input type="password" name="cur" autocomplete="current-password">
      <label>New password</label><input type="password" name="pw" autocomplete="new-password">
      <label>Repeat new password</label><input type="password" name="pw2" autocomplete="new-password"></div>
    <p class="muted">Every other device is signed out and has to sign in with the new password.</p>
    <div class="ct-err"></div><div class="row"><span class="grow"></span><button type="button" data-x>Cancel</button><button class="on">Change</button></div>`, (f, close) => {
    f.querySelector<HTMLButtonElement>('[data-x]')!.onclick = close;
    f.onsubmit = async e => {
      e.preventDefault();
      const err = f.querySelector('.ct-err')!, pw = val(f, 'pw');
      const min = syncServer().mode === 'public' ? 10 : 8;
      err.textContent = pw.length < min ? `Use at least ${min} characters` : pw !== val(f, 'pw2') ? 'The new passwords don’t match' : '';
      if (err.textContent) return;
      try { await api('/api/auth/password', { body: { current: val(f, 'cur'), password: pw } }); close(); toast('Password changed — other devices are signed out', 5000) }
      catch (x) { err.textContent = (x as Error).message }
    };
  });
}
/** Snapshot and layout links made with "Copy link to image" / "Share link"; deleting one makes it stop working. */
async function shares() {
  type L = { id: string; kind: 'snap' | 'layout'; url: string; name: string | null; created: number; bytes: number };
  let list: L[];
  try { list = await api<L[]>('/api/share') } catch (e) { return toast((e as Error).message) }
  const t = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  dialog('Shared links', `${list.length ? `<table><tr><th>What</th><th>Created</th><th></th></tr>
    ${list.map(s => `<tr><td>${s.kind === 'snap' ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Chart image</a> <span class="muted">${Math.ceil(s.bytes / 1024)} KB</span>` : `Layout “${esc(s.name ?? '')}”`}</td><td>${esc(t(s.created))}</td>
      <td style="white-space:nowrap"><button type="button" data-copy="${esc(s.url)}">Copy</button> <button type="button" data-del="${esc(s.id)}">Delete</button></td></tr>`).join('')}</table>` : '<p class="muted">No shared links.</p>'}
    <p class="muted">Anyone who has an image link can open it. Layout links only work for you, signed in.</p>
    <div class="row"><span class="grow"></span><button class="on">Close</button></div>`, (f, close) => {
    f.onsubmit = e => { e.preventDefault(); close() };
    f.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(b => b.onclick = () => {
      const url = location.origin + b.dataset.copy!;
      navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => { prompt('Link', url) });
    });
    f.querySelectorAll<HTMLButtonElement>('[data-del]').forEach(b => b.onclick = async () => {
      try { await api(`/api/share/${encodeURIComponent(b.dataset.del!)}`, { method: 'DELETE' }); b.closest('tr')!.remove(); toast('Link deleted') }
      catch (e) { toast((e as Error).message) }
    });
  });
}
async function sessions() {
  type S = { label?: string; id: string; created: number; last_seen?: number; lastUsed?: number; agent: string | null; ip: string | null; current: boolean };
  let list: S[];
  let base = '/api/auth/devices';
  try { list = await api<S[]>(base).catch(e => { if ((e as { status?: number }).status !== 404) throw e; base = '/api/auth/sessions'; return api<S[]>(base) }) } catch (e) { return toast((e as Error).message) }
  const t = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const device = (a: string | null) => !a ? 'Unknown' : /iPhone|iPad/.test(a) ? 'iPhone / iPad' : /Android/.test(a) ? 'Android' : /Windows/.test(a) ? 'Windows' : /Mac OS/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : a.slice(0, 40);
  dialog('Devices & sessions', `<table><tr><th>Device</th><th>Address</th><th>Last active</th><th></th></tr>
    ${list.map(s => `<tr title="${esc(`${s.agent ?? ''}
Signed in ${t(s.created)}`)}"><td>${esc(s.label || device(s.agent))}${s.current ? ' <span class="muted">(this device)</span>' : ''}</td><td>${esc(s.ip ?? '')}</td><td>${esc(t(s.last_seen ?? s.lastUsed ?? s.created))}</td>
      <td>${s.current ? '' : `<button type="button" data-end="${esc(s.id)}" style="white-space:nowrap">Sign out</button>`}</td></tr>`).join('')}</table>
    <p class="muted">To sign every other device out at once, change the password.</p>
    <div class="row"><span class="grow"></span><button class="on">Close</button></div>`, (f, close) => {
    f.onsubmit = e => { e.preventDefault(); close() };
    f.querySelectorAll<HTMLButtonElement>('[data-end]').forEach(b => b.onclick = async () => {
      try { await api(`${base}/${encodeURIComponent(b.dataset.end!)}`, { method: 'DELETE' }); b.closest('tr')!.remove(); toast('Device signed out') }
      catch (e) { toast((e as Error).message) }
    });
  });
}
