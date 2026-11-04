// Public-server sign-in: username + password, create account, recovery with a code, the one-time recovery-codes screen
// and the forced password change. Private servers keep the single-password loginScreen in login.ts.
import { api } from './sync.ts';
import { esc } from './store.ts';
import { authPost, screen, val } from './login.ts';
import { checkName, checkPassword, codesOf, formatRecoveryCodes } from './authrules.ts';
import type { ServerStatus } from './servers.ts';

type User = ServerStatus['user'];
const head = (st: Pick<ServerStatus, 'mode' | 'serverName'>) => `<h2>${esc(st.serverName ?? 'Chart Terminal')}</h2><p class="muted">${st.mode === 'public' ? 'Public server: your account and synced data live here. It never stores exchange keys or places orders.' : 'Private server'}</p>`;
const NAME = '<input name="name" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">';

export async function accountScreen(st: ServerStatus): Promise<User> {
  let view = 'login', user: User;
  for (;;) {
    let n: string;
    if (view === 'login') {
      n = await screen(`${head(st)}${NAME}<input type="password" name="pw" placeholder="Password" autocomplete="current-password">`, async f => {
        const name = val(f, 'name').trim(), pw = val(f, 'pw'); if (!name || !pw) throw Error('Enter your username and password');
        user = (await authPost<{ user?: User }>('/api/auth/login', { name, password: pw })).user;
      }, `<div class="row"><button type="button" data-go="recover">Forgot password?</button><span class="grow"></span>${st.registration !== 'closed' ? '<button type="button" data-go="register">Create account</button>' : ''}</div>`, 'Sign in');
    } else if (view === 'register') {
      n = await screen(`${head(st)}<p>Create an account</p>${NAME}
        <input type="password" name="pw" placeholder="Password (at least 10 characters)" autocomplete="new-password">
        <input type="password" name="pw2" placeholder="Repeat the password" autocomplete="new-password">
        ${st.registration === 'invite' ? '<input name="invite" placeholder="Invite code" autocomplete="off" autocapitalize="none" spellcheck="false">' : ''}`, async f => {
        const name = checkName(val(f, 'name')), pw = checkPassword(val(f, 'pw'), name);
        if (pw !== val(f, 'pw2')) throw Error('The passwords don’t match');
        const invite = st.registration === 'invite' ? val(f, 'invite').trim() : '';
        if (st.registration === 'invite' && !invite) throw Error('Enter the invite code you were given');
        const j = await authPost<{ user?: User }>('/api/auth/register', { name, password: pw, ...(invite ? { invite } : {}) });
        user = j.user; await recoveryCodesScreen(codesOf(j), name);
      }, '<div class="row"><button type="button" data-go="login">I already have an account</button></div>', 'Create account');
    } else {
      n = await screen(`${head(st)}<p>Enter one of the recovery codes you saved when you created the account, and choose a new password.</p>${NAME}
        <input name="code" placeholder="Recovery code" autocomplete="off" autocapitalize="none" spellcheck="false">
        <input type="password" name="pw" placeholder="New password (at least 10 characters)" autocomplete="new-password">
        <input type="password" name="pw2" placeholder="Repeat the new password" autocomplete="new-password">`, async f => {
        const name = checkName(val(f, 'name')), pw = checkPassword(val(f, 'pw'), name), code = val(f, 'code').trim();
        if (!code) throw Error('Enter a recovery code');
        if (pw !== val(f, 'pw2')) throw Error('The passwords don’t match');
        const j = await authPost<{ user?: User }>('/api/auth/recover', { name, code, newPassword: pw });
        user = j.user ?? { name }; await recoveryCodesScreen(codesOf(j), name);
      }, '<div class="row"><button type="button" data-go="login">Back to sign in</button></div>', 'Set new password');
    }
    if (n === 'done') break;
    view = n;
  }
  return user;
}

/** Shown once: the codes, copy / download, and a checkbox that must be ticked before continuing. */
export function recoveryCodesScreen(codes: string[], who: string): Promise<string> {
  if (!codes.length) return Promise.resolve('done');
  const text = formatRecoveryCodes(codes, who);
  const p = screen(`<h2>Save your recovery codes</h2>
    <p>If you forget your password, one of these codes lets you back in. <b>They are shown only now</b> and each works once. There is no email reset.</p>
    <pre style="user-select:all;margin:0;line-height:1.7">${esc(codes.join('\n'))}</pre>
    <div class="row"><button type="button" data-copy>Copy</button><button type="button" data-save>Download</button></div>
    <label class="row"><input type="checkbox" name="ok"> I saved these codes somewhere safe</label>`, async f => {
    if (!(f.elements.namedItem('ok') as HTMLInputElement).checked) throw Error('Tick the box after you saved the codes');
  });
  const f = (document.body.lastElementChild as HTMLElement).querySelector('form')!;
  f.querySelector<HTMLElement>('[data-copy]')!.onclick = () => { void navigator.clipboard?.writeText(text).catch(() => {}) };
  f.querySelector<HTMLElement>('[data-save]')!.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'chart-terminal-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  return p;
}

/** Admin-issued temporary password: nothing else works until it is changed. */
export function mustChangeScreen(name: string): Promise<string> {
  return screen(`<h2>Choose a new password</h2><p>You are signed in with a temporary password. Choose your own to continue.</p>
    <input type="password" name="cur" placeholder="Temporary password" autocomplete="current-password">
    <input type="password" name="pw" placeholder="New password (at least 10 characters)" autocomplete="new-password">
    <input type="password" name="pw2" placeholder="Repeat the new password" autocomplete="new-password">`, async f => {
    const pw = checkPassword(val(f, 'pw'), name.toLowerCase());
    if (pw !== val(f, 'pw2')) throw Error('The passwords don’t match');
    await api('/api/auth/password', { body: { current: val(f, 'cur'), password: pw } });
  });
}
