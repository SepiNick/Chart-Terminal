// Account menu -> "Sign-in methods…": linked Google / Apple identities, link and unlink (design §2.4).
import { api } from './sync.ts';
import { dialog, val } from './login.ts';
import { esc, toast } from './store.ts';
import { parseStatus } from './servers.ts';
import { identities, unlinkIdentity, type Provider } from './oauthapi.ts';
import { oauthAvailable, startOAuth } from './oauth.ts';

const NAMES: Record<Provider, string> = { google: 'Google', apple: 'Apple', telegram: 'Telegram' };
export async function signInMethods() {
  let ids, st;
  try { [ids, st] = await Promise.all([identities(), api<unknown>('/api/auth/status').then(parseStatus)]) } catch (e) { return toast((e as Error).message) }
  const count = (ids.hasPassword ? 1 : 0) + ids.list.length;
  const can = (p: Provider) => oauthAvailable() && !!st?.oauth[p];
  dialog('Sign-in methods', `<table><tr><td>Password</td><td>${ids.hasPassword ? 'set' : 'not set'}</td><td></td></tr>
    ${(['google', 'apple', 'telegram'] as Provider[]).map(p => { const i = ids.list.find(x => x.provider === p); return `<tr><td>${NAMES[p]}</td><td>${i ? esc(i.relay ? 'Hidden email (Apple)' : i.email ?? 'linked') : 'not linked'}</td><td>${
      i ? `<button type="button" data-un="${p}"${count <= 1 ? ' disabled title="Your only sign-in method"' : ''}>Unlink</button>` : can(p) ? `<button type="button" data-ln="${p}">Link</button>` : ''}</td></tr>` }).join('')}</table>
    ${count <= 1 ? '<p class="muted">You cannot remove your last sign-in method. Link another one first.</p>' : ''}
    ${ids.hasPassword ? '<div class="form"><label>Password (to confirm)</label><input type="password" name="pw" autocomplete="current-password"></div>' : ''}
    <div class="ct-err"></div><div class="row"><span class="grow"></span><button class="on">Close</button></div>`, (f, close) => {
    const err = f.querySelector('.ct-err')!, pw = () => (ids.hasPassword ? val(f, 'pw') : '');
    f.onsubmit = e => { e.preventDefault(); close() };
    f.onclick = async e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-un],[data-ln]'); if (!b) return;
      err.textContent = '';
      try {
        if (ids.hasPassword && !pw()) throw Error('Enter your password to confirm');
        if (b.dataset.ln) await startOAuth(b.dataset.ln as Provider, 'link', pw());
        else { await unlinkIdentity(b.dataset.un as Provider, pw()); close(); toast(`${NAMES[b.dataset.un as Provider]} unlinked`); }
      } catch (x) { err.textContent = (x as { status?: number }).status === 409 ? 'You cannot remove your last sign-in method. Link another one or set a password first.' : (x as Error).message }
    };
  });
}
