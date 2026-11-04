import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from './servers.ts';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } };
beforeEach(() => S._reset(mem()));

test('normalizeBaseUrl', () => {
  assert.equal(S.normalizeBaseUrl('my.server.com'), 'https://my.server.com');
  assert.equal(S.normalizeBaseUrl('192.168.1.5:8787/foo?x=1#y'), 'http://192.168.1.5:8787');
  assert.equal(S.normalizeBaseUrl('localhost:8787'), 'http://localhost:8787');
  assert.equal(S.normalizeBaseUrl(' https://a.b/ '), 'https://a.b');
  for (const bad of ['', 'ftp://x.y', 'https://u:p@x.y', 'http://']) assert.throws(() => S.normalizeBaseUrl(bad));
});

test('headers, urls and socket subprotocol', () => {
  const same = { baseUrl: '', token: 'T' }, other = { baseUrl: 'https://a.b', token: 'T' };
  assert.deepEqual(S.authHeaders(same, 'c1', 'https://page'), { 'x-ct-client': 'c1' });
  assert.deepEqual(S.authHeaders(other, 'c1', 'https://page'), { 'x-ct-client': 'c1', authorization: 'Bearer T' });
  assert.equal(S.serverUrl(other, '/api/x', 'https://page'), 'https://a.b/api/x');
  assert.equal(S.serverUrl(same, '/api/x', 'https://page'), '/api/x');
  assert.throws(() => S.serverUrl(other, '//evil.com/x'));
  assert.throws(() => S.serverUrl(other, 'https://evil.com/x'));
  const loc = { origin: 'https://page', protocol: 'https:', host: 'page' };
  assert.deepEqual(S.socketArgs(same, '/ws', loc), { url: 'wss://page/ws' });
  assert.deepEqual(S.socketArgs(other, '/ws', loc), { url: 'wss://a.b/ws', protocols: ['ct.T'] });
  assert.equal(S.socketArgs({ baseUrl: 'http://10.0.0.2:1', token: 'T' }, '/ws', loc).url, 'ws://10.0.0.2:1/ws');
});

test('parseStatus and feature defaults', () => {
  assert.equal(S.parseStatus('<html>'), null);
  assert.equal(S.parseStatus({ setup: false }), null);
  const priv = S.parseStatus({ setup: false, loggedIn: true })!;
  assert.equal(priv.mode, 'private');
  assert.deepEqual(priv.features, S.ALL_FEATURES);
  const pub = S.parseStatus({ setup: false, loggedIn: false, mode: 'public', registration: 'open', serverName: 'X', features: { trading: false, ai: true } })!;
  assert.equal(pub.registration, 'open');
  assert.equal(pub.features.trading, false);
  assert.equal(pub.features.ai, true);
  assert.equal(pub.features.forward, false);
  assert.equal(S.parseStatus({ loggedIn: false, mode: 'public', features: { brokers: true } })!.features.trading, true);
  assert.equal(S.parseStatus({ loggedIn: false, mode: 'public' })!.registration, 'invite');
});

test('trading server rules and gating', () => {
  assert.equal(S.canBeTradeServer({ baseUrl: 'https://a.b', mode: 'public' }).ok, false);
  assert.equal(S.canBeTradeServer({ baseUrl: 'https://a.b', mode: 'private' }).ok, true);
  assert.equal(S.canBeTradeServer({ baseUrl: 'http://localhost:8787' }).ok, true);
  assert.equal(S.canBeTradeServer({ baseUrl: 'https://a.b' }).ok, false);
  const pub = { mode: 'public' as const, features: { ...S.ALL_FEATURES, trading: false } };
  assert.match(S.gateFor('trading', pub, null).why, /never stores exchange keys/);
  assert.equal(S.gateFor('ai', pub, { mode: 'private', features: S.ALL_FEATURES }).on, true);
  assert.equal(S.gateFor('ai', pub, { mode: 'private', features: { ...S.ALL_FEATURES, ai: false } }).on, false);
  assert.equal(S.gateFor('scripts', { mode: 'public', features: { ...S.ALL_FEATURES, scripts: false } }, null).on, false);
});

test('mixed content warning', () => {
  assert.ok(S.mixedContentWarning({ baseUrl: 'http://192.168.1.5:8787' }, 'https:'));
  assert.equal(S.mixedContentWarning({ baseUrl: 'http://192.168.1.5:8787' }, 'http:'), null);
  assert.equal(S.mixedContentWarning({ baseUrl: 'http://localhost:8787' }, 'https:'), null);
  assert.equal(S.mixedContentWarning({ baseUrl: 'https://a.b' }, 'https:'), null);
});

test('saved servers: tokens only for other servers, trade never defaults to a public server', () => {
  assert.equal(S.syncServer().id, 'local');
  S.setToken('local', 'x');
  assert.equal(S.syncServer().token, undefined);
  const a = S.addServer('https://pub.example', 'Pub');
  S.setToken(a.id, 'TOK');
  assert.equal(S.serverById(a.id)!.token, 'TOK');
  assert.equal(S.addServer('pub.example').id, a.id);
  S.recordStatus(a.id, S.parseStatus({ loggedIn: false, mode: 'public' })!);
  S.setSyncServer(a.id);
  assert.equal(S.tradeServer(), null);
  assert.throws(() => S.setTradeServer(a.id));
  const p = S.addServer('http://192.168.1.9:8787');
  S.recordStatus(p.id, S.parseStatus({ loggedIn: true, mode: 'private' })!);
  S.setTradeServer(p.id);
  assert.equal(S.tradeServer()!.id, p.id);
});

test('persistence reloads; removing the active server falls back to local', () => {
  const st = mem();
  S._reset(st);
  const a = S.addServer('https://pub.example');
  S.setToken(a.id, 'TOK');
  S.setSyncServer(a.id);
  S._reset(st);
  assert.equal(S.syncServer().id, a.id);
  assert.equal(S.syncServer().token, 'TOK');
  S.removeServer(a.id);
  assert.equal(S.syncServer().id, 'local');
});

test('serverFetch: trading never uses the sync server; bearer and client header sent', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}') }) as typeof fetch;
  try {
    const a = S.addServer('https://pub.example');
    S.setToken(a.id, 'TOK');
    S.setSyncServer(a.id);
    S.recordStatus(a.id, S.parseStatus({ loggedIn: true, mode: 'public' })!);
    await assert.rejects(S.serverFetch('/api/broker/accounts', {}, 'trade'), /No trading server/);
    assert.equal(calls.length, 0);
    await S.serverFetch('/api/state', { method: 'GET' });
    const h = new Headers(calls[0].init.headers);
    assert.equal(calls[0].url, 'https://pub.example/api/state');
    assert.equal(h.get('authorization'), 'Bearer TOK');
    assert.equal(h.get('x-ct-client'), S.clientId);
    assert.equal(calls[0].init.credentials, 'omit');
  } finally { globalThis.fetch = real }
});

test('broker code goes through the trading client only', () => {
  const src = readFileSync(new URL('./broker/remote.ts', import.meta.url), 'utf8');
  assert.ok(/call: Api = apiTrade/.test(src));
  assert.ok(!/import \{[^}]*\bapi\b[^}]*\} from '\.\.\/sync\.ts'/.test(src));
});

test('deviceLabel', () => {
  assert.equal(S.deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'Windows · Chrome');
  assert.equal(S.deviceLabel(''), 'Device · browser');
});
