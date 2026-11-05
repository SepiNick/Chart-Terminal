// CT_REGISTRATION=closed: a first Google sign-in must not create an account (and an existing identity still signs in).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

const freePort = async () => {
  for (;;) {
    const p = 19000 + Math.floor(Math.random() * 1000);
    if (await new Promise<boolean>(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))) })) return p;
  }
};
const { startMock } = await import('./oidcmock.ts');
const { boot, client } = await import('./publictest.ts');
const port = await freePort(), mock = await startMock({ port: await freePort(), google: { clientId: 'gid', secret: 'gs' } });
const b = await boot({ CT_REGISTRATION: 'closed', CT_PUBLIC_URL: `http://localhost:${port}`, CT_GOOGLE_CLIENT_ID: 'gid', CT_GOOGLE_CLIENT_SECRET: 'gs', CT_AUTH_BURST: '1000', CT_ANON_BURST: '1000' }, port);
after(() => { b.close(); mock.close() });
(await import('./oauth.ts'))._setProvidersForTest({ google: mock.urls });
const { db } = await import('./core/db.ts');

test('closed registration: the ticket cannot become an account', async () => {
  const c = client(b.base), verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
  const s = await c.json('POST', '/api/auth/oauth/start', { provider: 'google', intent: 'login', challenge, ret: 'web' });
  const pc = mock.authorize(s.body.url, { sub: 'closed-sub', email: 'c@example.com' });
  const res = await fetch(`${b.base}/api/auth/oauth/callback/google?code=${pc}&state=${new URL(s.body.url).searchParams.get('state')}`, { redirect: 'manual' });
  const code = /oauth=([\w-]+)/.exec(res.headers.get('location')!)![1];
  const ex = await c.json('POST', '/api/auth/oauth/exchange', { code, verifier });
  assert.equal(ex.body.signup, true);
  const r = await c.json('POST', '/api/auth/oauth/signup', { ticket: ex.body.ticket, verifier, name: 'closed-user', invite: b.U.createInvite(null) });
  assert.equal(r.status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM identities').get() as { n: number }).n, 0);
});
