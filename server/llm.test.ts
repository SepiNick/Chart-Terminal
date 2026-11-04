import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CT_DATA_DIR = mkdtempSync(join(tmpdir(), 'ct-llm-'));
process.env.CT_NO_AUTOSTART = '1';
const L = await import('./llm.ts');

test('model URL: loopback only', () => {
  assert.equal(L.baseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
  assert.equal(L.baseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
  for (const u of ['http://10.0.0.5:11434/v1', 'http://evil.com/v1', 'http://127.0.0.1.evil.com/v1', 'file:///etc/passwd', 'http://user:pw@127.0.0.1/v1', 'nonsense', 'http://127.0.0.1:8787/v1', 'http://127.0.0.1/v1', 'https://127.0.0.1/v1', 'http://127.0.0.1:1234/api/x', 'http://127.0.0.1:1234/v1?a=1']) assert.throws(() => L.baseUrl(u), /computer|URL|Model URL/, u);
});
test('status falls back across local servers; chat forwards and strips <think>', async () => {
  const seen: { url: string; body?: string }[] = [];
  L.deps.fetch = async (url: string, init?: RequestInit) => {
    seen.push({ url, body: init?.body as string | undefined });
    if (url.startsWith('http://127.0.0.1:11434')) throw new TypeError('ECONNREFUSED');
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen2.5-7b' }, { id: 'llama3.1-8b' }] }));
    return new Response(JSON.stringify({ choices: [{ message: { content: '<think>hmm</think>\nHello' } }] }));
  };
  const s = await L.status();
  assert.deepEqual([s.online, s.url, s.models], [true, 'http://127.0.0.1:1234/v1', ['llama3.1-8b', 'qwen2.5-7b']]);
  const r = await L.chat({ url: s.url, model: 'qwen2.5-7b', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }, { role: 'tool', content: 'x' }] });
  assert.equal(r.text, 'Hello');
  assert.deepEqual(JSON.parse(seen.at(-1)!.body!).messages.map((m: { role: string }) => m.role), ['system', 'user']);
  await assert.rejects(L.chat({ model: '', messages: [{ role: 'user', content: 'x' }] }), /Pick a model/);
  await assert.rejects(L.chat({ url: 'http://example.com/v1', model: 'm', messages: [{ role: 'user', content: 'x' }] }), /computer/);
});
