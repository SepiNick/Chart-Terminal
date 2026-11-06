// Builds openapi.json from the server's route('METHOD', '/path', ...) calls, for DAST scans (HawkScan).
// Paths, methods and path parameters only: request bodies are not in the source in a form a script can read.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../server/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'data') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) files.push(p);
  }
})(root);

const paths = {}, add = (method, path, pub) => {
  const oas = path.replace(/:(\w+)/g, '{$1}'), op = (paths[oas] ??= {});
  const params = [...oas.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
  const body = /^(POST|PUT|PATCH)$/.test(method) ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {};
  op[method.toLowerCase()] = { ...(params.length ? { parameters: params } : {}), ...body, responses: { 200: { description: 'ok' } }, ...(pub ? {} : { security: [{ bearer: [] }] }) };
};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\broute\(\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*'(\/[^']*)'/g)) add(m[1], m[2], false);
  // The market routes are registered in a loop over a list of paths, all GET.
  for (const m of src.matchAll(/for \(const p of \[([^\]]+)\]\) route\('GET'/g)) for (const p of m[1].matchAll(/'(\/[^']+)'/g)) add('GET', p[1], false);
}
const spec = { openapi: '3.0.3', info: { title: 'Chart Terminal server', version: '1' }, servers: [{ url: '/' }], paths, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } };
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(spec, null, 1));
console.log(Object.keys(paths).length, 'paths,', Object.values(paths).reduce((a, o) => a + Object.keys(o).length, 0), 'operations');
