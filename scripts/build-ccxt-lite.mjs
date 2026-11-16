// Builds the browser-only CCXT bundles used by the Android app: dist-ccxt/lite.js (curated) and dist-ccxt/full.js (every exchange).
// Each is an IIFE that sets globalThis.ccxtLite = { <id>: ExchangeClass, ids: [...] } (full.js replaces lite's object with a superset). Never part of dist/ (web/desktop); build-android.mjs adds them as ccxt/lite.js and ccxt/full.js.
// Usage: node scripts/build-ccxt-lite.mjs
import { build } from 'esbuild';
import ccxt from 'ccxt';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist-ccxt');
const LITE = ['binance', 'bybit', 'okx', 'kraken', 'coinbase', 'kucoin', 'bitget', 'gate', 'mexc', 'htx', 'bitfinex', 'bitstamp', 'gemini', 'cryptocom', 'deribit', 'phemex', 'bingx', 'lbank', 'whitebit', 'upbit', 'bithumb', 'poloniex', 'bitvavo', 'hyperliquid',
  // every CATALOG provider routed to ccxt (src/providers/catalog.ts) and every DEFAULT_EXCHANGES id must be here (the test checks)
  'binanceusdm', 'binancecoinm', 'kucoinfutures', 'krakenfutures', 'blofin', 'deepcoin', 'dydx', 'woo', 'aster', 'paradex', 'lighter', 'backpack', 'coinbaseinternational'];
const has = (id) => existsSync(join(root, 'node_modules/ccxt/js/src', id + '.js'));
const FULL = [...ccxt.exchanges].filter(has).sort();
const stub = 'export default {};'; // node:crypto shim; browser builds sign through ccxt's own pure-JS hashes

const bundle = (ids, file) => build({
  stdin: {
    // package exports only expose '.', so import the per-exchange modules by relative path
    contents: ids.map((id, i) => `import x${i} from './node_modules/ccxt/js/src/${id}.js';`).join('\n')
      + `\nglobalThis.ccxtLite = { ${ids.map((id, i) => `${JSON.stringify(id)}: x${i}`).join(', ')}, ids: ${JSON.stringify(ids)} };`,
    resolveDir: root, sourcefile: 'ccxt-entry.js',
  },
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none', logLevel: 'error',
  external: ['node:*', 'undici', 'protobufjs/minimal', 'protobufjs/minimal.js'],
  plugins: [{ name: 'crypto-stub', setup(b) { b.onResolve({ filter: /^crypto$/ }, () => ({ path: 'crypto', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' })); } }],
  outfile: file, write: false,
}).then((r) => r.outputFiles[0].text);

mkdirSync(out, { recursive: true });
const liteIds = LITE.filter(has); // an id this ccxt version does not ship is dropped, not fatal
const dropped = LITE.filter((id) => !has(id));
for (const [name, ids] of [['lite', liteIds], ['full', FULL]]) {
  const text = await bundle(ids, name);
  writeFileSync(join(out, name + '.js'), text);
  console.log(`${name}.js: ${ids.length} exchanges, ${(text.length / 1024).toFixed(0)} KB raw, ${(gzipSync(text).length / 1024).toFixed(0)} KB gzip`);
}
if (dropped.length) console.warn('dropped from lite:', dropped.join(', '));
