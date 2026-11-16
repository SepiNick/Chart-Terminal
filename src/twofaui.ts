// Two-step sign-in screens: the code step of a login, enrolment (QR + confirm + recovery codes) and the Security dialog
// (account menu → Two-step verification). HTTP lives in twofaapi.ts.
import { dialog, screen, val } from './login.ts';
import { recoveryCodesScreen } from './accountscreens.ts';
import { esc, toast } from './store.ts';
import { codeBody, svgSrc, twofaDisable, twofaEnable, twofaSetup, twofaStatus, type Setup } from './twofaapi.ts';

/** Second step of a sign-in: the 6-digit code (or a recovery code). Resolves with what `post` returned; throws when cancelled. */
export async function twofaStep<T>(ticket: string, post: (path: string, body: Record<string, unknown>) => Promise<T>): Promise<T> {
  let recovery = false;
  for (;;) {
    let out: T | undefined;
    const n = await screen(`<h2>Two-step verification</h2>
      <p>${recovery ? 'Enter one of your recovery codes. Each one works only once.' : 'Open your authenticator app and enter the 6-digit code for this server.'}</p>
      <input name="code" ${recovery ? 'autocapitalize="none"' : 'inputmode="numeric" maxlength="7"'} autocomplete="one-time-code" spellcheck="false" placeholder="${recovery ? 'Recovery code' : '123456'}">`, async f => {
      out = await post('/api/auth/login/2fa', { ticket, ...codeBody(val(f, 'code'), recovery) });
    }, `<div class="row"><button type="button" data-go="${recovery ? 'code' : 'recovery'}">${recovery ? 'Use the authenticator code' : 'Use a recovery code'}</button><span class="grow"></span><button type="button" data-go="cancel">Cancel</button></div>`, 'Verify');
    if (n === 'done') return out as T;
    if (n === 'cancel') throw Error('Sign-in cancelled');
    recovery = n === 'recovery';
  }
}

/** QR + secret, then a code to confirm, then the recovery codes (shown once). Returns false when cancelled. */
export async function enrolScreen(forced = false): Promise<boolean> {
  let setup: Setup | undefined;
  for (;;) {
    const n = await screen(`<h2>Turn on two-step verification</h2>
      <p>${forced ? 'This server requires two-step verification for your account. ' : ''}You will need an authenticator app (Google Authenticator, Aegis, 1Password, …). Enter your password to start.</p>
      <input type="password" name="pw" placeholder="Password" autocomplete="current-password">`, async f => {
      const pw = val(f, 'pw'); if (!pw) throw Error('Enter your password');
      setup = await twofaSetup(pw);
    }, '<div class="row"><span class="grow"></span><button type="button" data-go="cancel">Cancel</button></div>', 'Continue');
    if (n === 'cancel') return false;
    const s = setup!;
    let codes: string[] = [];
    const m = await screen(`<h2>Scan this code</h2>
      <p>In your authenticator app add an account and scan the picture, or type the key by hand. Then enter the 6 digits it shows.</p>
      <img alt="QR code for your authenticator app" src="${esc(svgSrc(s.qrSvg))}" style="width:200px;height:200px;align-self:center;background:#fff;padding:6px;border-radius:6px">
      <input readonly value="${esc(s.secret)}" aria-label="Setup key" style="user-select:all;text-align:center;letter-spacing:1px" onfocus="this.select()">
      <input name="code" inputmode="numeric" maxlength="7" autocomplete="one-time-code" placeholder="123456">`, async f => {
      codes = await twofaEnable((codeBody(val(f, 'code'), false) as { code: string }).code);
    }, '<div class="row"><span class="grow"></span><button type="button" data-go="cancel">Cancel</button></div>', 'Turn on');
    if (m === 'cancel') return false;
    await recoveryCodesScreen(codes, '');
    return true;
  }
}

/** Account menu → Two-step verification: status, turn on / off. */
export async function twofaSettings() {
  let st; try { st = await twofaStatus() } catch (e) { return toast((e as Error).message) }
  dialog('Two-step verification', `<p>${st.enabled ? 'On. Signing in needs your password and a code from your authenticator app.' : 'Off. Add a code from an authenticator app to every sign-in for more safety.'}</p>
    ${st.required ? '<p class="muted ct-warn">This server requires it, so it cannot be turned off.</p>' : ''}
    ${st.enabled && st.recoveryLeft !== undefined ? `<p class="muted">${st.recoveryLeft} recovery code${st.recoveryLeft === 1 ? '' : 's'} left.</p>` : ''}
    ${st.enabled && !st.required ? '<div class="form"><label>Password</label><input type="password" name="pw" autocomplete="current-password"><label>Code</label><input name="code" autocomplete="one-time-code" placeholder="123456 or a recovery code"></div>' : ''}
    <div class="ct-err" data-err></div>
    <div class="row"><span class="grow"></span><button type="button" data-x>Close</button>${st.enabled ? (st.required ? '' : '<button type="button" data-off class="on">Turn off</button>') : '<button type="button" data-on class="on">Turn on…</button>'}</div>`, (f, close) => {
    const err = f.querySelector<HTMLElement>('[data-err]')!;
    f.querySelector<HTMLElement>('[data-x]')!.onclick = close;
    f.onsubmit = e => e.preventDefault();
    const on = f.querySelector<HTMLButtonElement>('[data-on]');
    if (on) on.onclick = () => { close(); void enrolScreen().then(ok => ok && toast('Two-step verification is on')) };
    const off = f.querySelector<HTMLButtonElement>('[data-off]');
    if (off) off.onclick = async () => {
      err.textContent = '';
      try {
        const code = val(f, 'code').trim(); if (!val(f, 'pw') || !code) throw Error('Enter your password and a code');
        await twofaDisable(val(f, 'pw'), code); close(); toast('Two-step verification is off');
      } catch (x) { err.textContent = (x as Error).message }
    };
  });
}
