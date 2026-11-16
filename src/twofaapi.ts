// All HTTP of two-step sign-in (TOTP) and phone pairing, in one place (routes: see the task's SERVER section).
// Pure helpers (the login step machine, code input) are tested in twofa.test.ts.
import { api } from './sync.ts';
import { codesOf } from './authrules.ts';

// ---------- login step machine ----------
export interface TwofaStatus { enabled: boolean; required: boolean; recoveryLeft?: number }
export const parseTwofaStatus = (j: unknown): TwofaStatus => {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  return { enabled: o.enabled === true, required: o.required === true, recoveryLeft: typeof o.recoveryLeft === 'number' ? o.recoveryLeft : undefined };
};
export type LoginStep = { kind: 'code'; ticket: string } | { kind: 'enrol' } | { kind: 'done' };
/** Answer of a password step (POST /api/auth/login, or recover) -> what the sign-in screen does next. `st` is GET /api/auth/2fa/status after sign-in, when asked. */
export function nextLoginStep(j: unknown, st?: TwofaStatus | null): LoginStep {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  if (o.twofa === true && typeof o.ticket === 'string' && o.ticket) return { kind: 'code', ticket: o.ticket };
  if (o.enrol === true || (st && st.required && !st.enabled)) return { kind: 'enrol' };
  return { kind: 'done' };
}
/** What the user typed in the second step: 6 digits (spaces allowed) = authenticator code; recovery mode sends the text as a recovery code. */
export function codeBody(input: string, recovery: boolean): { code: string } | { recovery: string } {
  const t = input.trim();
  if (recovery) { if (!t) throw Error('Enter a recovery code'); return { recovery: t } }
  const d = t.replace(/\s/g, '');
  if (!/^\d{6}$/.test(d)) throw Error('Enter the 6 digits from your authenticator app');
  return { code: d };
}

// ---------- 2FA management (needs a signed-in session) ----------
export const twofaStatus = () => api<unknown>('/api/auth/2fa/status').then(parseTwofaStatus);
export interface Setup { secret: string; otpauth: string; qrSvg: string }
export async function twofaSetup(password: string): Promise<Setup> {
  const j = await api<Partial<Setup>>('/api/auth/2fa/setup', { body: { password } });
  if (typeof j.secret !== 'string' || typeof j.qrSvg !== 'string') throw Error('The server did not return a setup code');
  return { secret: j.secret, otpauth: String(j.otpauth ?? ''), qrSvg: j.qrSvg };
}
/** Confirms the first code; returns the recovery codes (shown once). */
export const twofaEnable = async (code: string) => codesOf(await api('/api/auth/2fa/enable', { body: { code } }));
export const twofaDisable = (password: string, code: string) => api('/api/auth/2fa/disable', { body: { password, code } });

/** An <img> source for server-made SVG: images never run scripts, so a hostile server cannot inject code the way innerHTML could. */
export const svgSrc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

// ---------- pairing ----------
export interface PairStart { code: string; expires: number; url: string; qrSvg: string; payload: string }
export async function pairStart(): Promise<PairStart> {
  const j = await api<Partial<PairStart>>('/api/auth/pair/start', { body: {} });
  if (typeof j.code !== 'string' || typeof j.payload !== 'string' || typeof j.expires !== 'number') throw Error('The server sent an unexpected pairing answer');
  return { code: j.code, expires: j.expires, url: String(j.url ?? ''), qrSvg: String(j.qrSvg ?? ''), payload: j.payload };
}
/**
 * Redeem a code at `base`, which is not necessarily the server this page is on (a token is returned, never a cookie, when
 * `remote`; same origin: the server sets the session cookie). Errors carry `.status` when the server answered.
 */
export async function pairRedeem(base: string, code: string, remote: boolean, device: string, timeoutMs = 10_000): Promise<{ token?: string; user?: unknown }> {
  const r = await fetch(`${remote ? base : ''}/api/auth/pair/redeem`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: remote ? 'omit' : 'same-origin',
    body: JSON.stringify(remote ? { code, device } : { code }), signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({})) as { error?: string; token?: string; user?: unknown };
  if (!r.ok) throw Object.assign(Error(j.error ?? `Server error ${r.status}`), { status: r.status });
  return j;
}
