// Test harness: boots the public-mode server in-process on an ephemeral port with a temp data dir.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function boot(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-pub-'));
  Object.assign(process.env, { CT_MODE: 'public', CT_DATA_DIR: dir, CT_PUBLIC_URL: 'http://localhost', CT_ALLOWED_HOSTS: 'localhost', CT_NO_AUTOSTART: '1', CT_REGISTRATION: 'invite', CT_NO_PROXY: '1' }, env);
  delete process.env.CT_SECRET_KEY;
  const app = await import('./app.ts');
  const U = await import('./core/users.ts');
  const server: Server = app.createServer();
  await new Promise<void>(r => server.listen(0, 'localhost', r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const close = () => { server.closeAllConnections(); server.close(); try { rmSync(dir, { recursive: true, force: true }) } catch {} };
  return { dir, U, base, server, close };
}

/** A browser-like client with its own cookie jar. */
export function client(base: string) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body instanceof Uint8Array;
    const r = await fetch(base + path, { method, redirect: 'manual', headers: { origin: base, 'x-ct-client': 'testclient-1', ...(cookie ? { cookie } : {}), ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return r;
  };
  const json = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => { const r = await call(method, path, body, headers); return { status: r.status, body: await r.json().catch(() => null) as any, headers: r.headers } };
  return { call, json, get cookie() { return cookie }, set cookie(c: string) { cookie = c } };
}
export const PASS = 'correct horse battery';
/** Register a user through the API with a fresh invite. */
export async function signup(b: Awaited<ReturnType<typeof boot>>, name: string, password = PASS) {
  const c = client(b.base);
  const r = await c.json('POST', '/api/auth/register', { name, password, invite: b.U.createInvite(null) });
  if (r.status !== 200) throw Error(`register ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return { c, codes: r.body.recoveryCodes as string[] };
}
