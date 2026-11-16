// Public-server sign-in: username + password, create account, recovery with a code, the one-time recovery-codes screen
// and the forced password change. Private servers keep the single-password loginScreen in login.ts.
import { api } from './sync.ts';
import { esc } from './store.ts';
import { authPost, pairFlash, screen, secondStep, val } from './login.ts';
import { checkName, checkPassword, codesOf, formatRecoveryCodes } from './authrules.ts';
import { parseStatus, type ServerStatus } from './servers.ts';
import { oauthSignup, type Provider } from './oauthapi.ts';
import { oauthAvailable, startOAuth, takeFlash } from './oauth.ts';

type User = ServerStatus['user'];
const head = (st: Pick<ServerStatus, 'mode' | 'serverName'>) => `<h2>${esc(st.serverName ?? 'Chart Terminal')}</h2><p class="muted">${st.mode === 'public' ? 'Public server: your account and synced data live here. It never stores exchange keys or places orders.' : 'Private server'}</p>`;
const NAME = '<input name="name" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">';

/** "Continue with Google / Apple" buttons; only for providers the server reports as configured. */
const oauthButtons = (st: ServerStatus) => !(st.oauth.google || st.oauth.apple || st.oauth.telegram) ? '' : !oauthAvailable() ? '<p class="muted">Sign-in with Google / Apple / Telegram works only in the browser at the server’s own address. Use your password here.</p>' :
  `<hr style="width:100%;border:0;border-top:1px solid var(--line)">${st.oauth.google ? '<button type="button" data-go="oauth:google">Continue with Google</button>' : ''}${st.oauth.apple ? '<button type="button" data-go="oauth:apple">Continue with Apple</button>' : ''}${st.oauth.telegram ? '<button type="button" data-go="oauth:telegram">Continue with Telegram</button><p class="muted">Telegram needs a VPN where it is blocked.</p>' : ''}`;

export async function accountScreen(st: ServerStatus): Promise<User> {
  let view = 'login', user: User, msg = takeFlash() || await pairFlash();
  for (;;) {
    let n: string;
    const flashed = msg ? `<p class="ct-err" role="alert">${esc(msg)}</p>` : ''; msg = '';
    if (view === 'login') {
      n = await screen(`${head(st)}${flashed}${NAME}<input type="password" name="pw" placeholder="Password" autocomplete="current-password">`, async f => {
        const name = val(f, 'name').trim(), pw = val(f, 'pw'); if (!name || !pw) throw Error('Enter your username and password');
        user = (await secondStep(await authPost<{ user?: User }>('/api/auth/login', { name, password: pw }))).user;
      }, `<div class="row"><button type="button" data-go="recover">Forgot password?</button><span class="grow"></span>${st.registration !== 'closed' ? '<button type="button" data-go="register">Create account</button>' : ''}</div>${oauthButtons(st)}`, 'Sign in');
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
      }, `<div class="row"><button type="button" data-go="login">I already have an account</button></div>${oauthButtons(st)}`, 'Create account');
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
    if (n.startsWith('oauth:')) { try { await startOAuth(n.slice(6) as Provider) } catch (e) { msg = (e as Error).message } continue }
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

/** After Google / Apple confirmed an identity that has no account yet: choose a username (and the invite code in invite mode). */
export async function oauthSignupScreen(s: { ticket: string; verifier: string }): Promise<void> {
  const st = parseStatus(await api<unknown>('/api/auth/status').catch(() => null));
  await screen(`<h2>Choose a username</h2><p>Your sign-in is confirmed. Pick the username for your new account.</p>
    <p class="muted">Already have an account here? Cancel, sign in with your password, then link Google, Apple or Telegram under Account -> Sign-in methods.</p>
    ${NAME}${st?.registration === 'invite' ? '<input name="invite" placeholder="Invite code" autocomplete="off" autocapitalize="none" spellcheck="false">' : ''}`, async f => {
    const name = checkName(val(f, 'name')), invite = (f.elements.namedItem('invite') as HTMLInputElement | null)?.value ?? '';
    const needInvite = st?.registration === 'invite';
    if (needInvite && !invite.trim()) throw Error('Enter the invite code you were given');
    const j = await oauthSignup({ ticket: s.ticket, verifier: s.verifier, name, ...(needInvite ? { invite: invite.trim() } : {}) });
    await recoveryCodesScreen(codesOf(j), name);
  }, '<div class="row"><button type="button" data-go="cancel">Cancel</button></div>', 'Create account');
}
