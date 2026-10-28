import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTestnetUrl, scrub, MainnetRefused } from './safety.ts';
import { parseSym } from './adapter.ts';
import { ccxtAdapter, lockToTestnet, make, type Cx } from './ccxtx.ts';

test('testnet allow-list: testnet hosts pass, mainnet and look-alikes are refused', () => {
  for (const u of ['https://testnet.binance.vision/api/v3/account', 'wss://stream.testnet.binance.vision/ws', 'https://testnet.binancefuture.com/fapi/v1/order',
    'wss://fstream.binancefuture.com/ws', 'https://api-testnet.bybit.com/v5/order/create', 'wss://stream-testnet.bybit.com/v5/private',
    'wss://wspap.okx.com:443/ws/v5', 'https://testnetapiv2.nobitex.ir/market/orders/add', 'https://demo-fapi.binance.com/fapi/v2/account']) assert.doesNotThrow(() => assertTestnetUrl(u), u);
  for (const u of ['https://api.binance.com/api/v3/account', 'https://fapi.binance.com/fapi/v1/order', 'https://api.bybit.com/v5/order/create',
    'https://api.nobitex.ir/market/orders/add', 'https://testnet.binance.vision.evil.com/x', 'https://evilbinancefuture.com/x', 'https://demo-fapi.binance.com.evil.io/x',
    'http://testnet.binance.vision/api', 'https://www.okx.com/api/v5/trade/order', 'not a url']) assert.throws(() => assertTestnetUrl(u), MainnetRefused, u);
  assert.doesNotThrow(() => assertTestnetUrl('https://www.okx.com/api/v5/trade/order', true), 'OKX REST only with the demo header');
});

test('a CCXT client that stays on mainnet is refused at creation, and every request is checked again', async () => {
  // Real CCXT instances, no network: sandbox mode is switched off by the stub so the URLs stay on mainnet.
  const orig = make.exchange;
  try {
    make.exchange = (id, o) => { const x = orig(id, o); x.setSandboxMode = () => {}; x.enableDemoTrading = () => {}; return x };
    assert.throws(() => ccxtAdapter('binance', 'spot', { apiKey: 'k', secret: 's' }), MainnetRefused);
    assert.throws(() => ccxtAdapter('binanceusdm', 'futures', { apiKey: 'k', secret: 's' }), MainnetRefused);
    assert.throws(() => ccxtAdapter('bybit', 'futures', { apiKey: 'k', secret: 's' }), MainnetRefused);
    make.exchange = (id, o) => { const x = orig(id, o); x.setSandboxMode = () => {}; delete x.headers!['x-simulated-trading']; return x };
    assert.throws(() => ccxtAdapter('okx', 'futures', { apiKey: 'k', secret: 's', passphrase: 'p' }), MainnetRefused, 'OKX without the demo header is mainnet');

    let x!: Cx;
    make.exchange = (id, o) => (x = orig(id, o));
    const a = ccxtAdapter('binance', 'spot', { apiKey: 'k', secret: 's' });
    assert.ok(a.hosts.every(h => /testnet|binancefuture/.test(h)));
    await assert.rejects(x.fetch('https://api.binance.com/api/v3/account'), MainnetRefused, 'the request guard refuses before any I/O');
    assert.throws(() => x.client?.('wss://stream.binance.com:9443/ws'), MainnetRefused, 'WebSocket guard');
    a.close();
    // Binance USDⓈ-M signs against demo trading (CCXT refuses the retired futures testnet).
    make.exchange = (id, o) => (x = orig(id, o));
    ccxtAdapter('binanceusdm', 'futures', { apiKey: 'k', secret: 's' });
    assert.match((x.sign as (...a: unknown[]) => { url: string })('account', 'fapiPrivateV2', 'GET', {}).url, /^https:\/\/demo-fapi\.binance\.com\//);
    // Even if something later rewrites the URLs, the per-request guard still holds.
    make.exchange = (id, o) => (x = orig(id, o));
    ccxtAdapter('okx', 'futures', { apiKey: 'k', secret: 's', passphrase: 'p' });
    delete x.headers!['x-simulated-trading'];
    await assert.rejects(x.fetch('https://www.okx.com/api/v5/account/balance'), MainnetRefused);
  } finally { make.exchange = orig }
  assert.throws(() => lockToTestnet(make.exchange('kucoin', {})), /no sandbox/);
});

test('scrub removes signed URLs, keys and token-like strings from errors', () => {
  const key = 'vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A';
  const s = scrub(Error(`binance GET https://testnet.binance.vision/api/v3/account?timestamp=1&signature=abcdef0123 401 {"msg":"bad key ${key}"} apiKey=SHORTKEY1`), ['SHORTKEY1']);
  assert.ok(!s.includes(key) && !s.includes('signature=abc') && !s.includes('SHORTKEY1'), s);
  assert.match(s, /testnet\.binance\.vision/);
});

test('app symbols parse to base / quote / perpetual', () => {
  assert.deepEqual(parseSym('BTCUSDT'), { base: 'BTC', quote: 'USDT', perp: false });
  assert.deepEqual(parseSym('BINANCE:ETHBTC'), { base: 'ETH', quote: 'BTC', perp: false });
  assert.deepEqual(parseSym('BTCFDUSD'), { base: 'BTC', quote: 'FDUSD', perp: false });
  assert.deepEqual(parseSym('BYBIT:BTC_USDT.P'), { base: 'BTC', quote: 'USDT', perp: true });
  assert.deepEqual(parseSym('OKX:BTC_USD.PBTC'), { base: 'BTC', quote: 'USD', perp: true, settle: 'BTC' });
  assert.deepEqual(parseSym('BTCIRT'), { base: 'BTC', quote: 'IRT', perp: false });
  assert.throws(() => parseSym('OKX:BTC_USD.F251226'));
  assert.throws(() => parseSym('FOO'));
});
