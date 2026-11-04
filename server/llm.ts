// Local language model for the AI panel: an OpenAI-compatible server on this machine (Ollama: http://127.0.0.1:11434/v1,
// LM Studio: http://127.0.0.1:1234/v1). Only loopback addresses are accepted, so this can never be pointed at another
// host; nothing leaves the PC. Set CT_LLM_URL / CT_LLM_MODEL for defaults; the panel may override both.
import { HttpError, bad, route } from './core/http.ts';

/** Swappable for tests. */
export const deps = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };
// LM Studio takes the next free port when 1234 is busy, so 1234-1239 are all accepted (only the first two are probed).
const DEFAULTS = ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:1234/v1', 'http://127.0.0.1:1235/v1'];
const LMS_PORTS = ['1234', '1235', '1236', '1237', '1238', '1239'];
/** A loopback http(s) base URL ending in /v1 (trailing slash trimmed), or an error. */
export function baseUrl(raw?: string | null) {
  const s = (raw || process.env.CT_LLM_URL || DEFAULTS[0]).trim().replace(/\/+$/, '');
  let u: URL; try { u = new URL(s) } catch { throw bad('Model URL is not a URL') }
  if (!/^https?:$/.test(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password) throw bad('Only a model server on this computer (127.0.0.1 / localhost) is allowed');
  const path = u.pathname.replace(/\/+$/, ''), port = (x: URL) => x.port || (x.protocol === 'https:' ? '443' : '80');
  let envPort: string[] = []; try { if (process.env.CT_LLM_URL) envPort = [port(new URL(process.env.CT_LLM_URL))] } catch { /* ignored: a bad CT_LLM_URL just adds nothing */ }
  // Fixed ports and path: an override can't be used to probe other local services (databases, this server, dev tools).
  if (path !== '/v1' || u.search || !['11434', ...LMS_PORTS, ...envPort].includes(port(u))) throw bad('Model URL must be http://127.0.0.1:11434/v1 (Ollama), :1234-1239/v1 (LM Studio) or the port in CT_LLM_URL');
  return `${u.origin}${path}`;
}
async function call(url: string, init: RequestInit = {}, ms = 10_000) {
  let r: Response;
  try { r = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(ms) }) }
  catch (e) { throw new HttpError(502, (e as Error).name === 'TimeoutError' ? 'The model took too long to answer' : 'No model server is running — start Ollama (ollama serve) or LM Studio\'s server') }
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new HttpError(502, `Model server answered with an error (${r.status})`);
  return j;
}
/** Which server answers and its models; tries the configured URL, then Ollama's and LM Studio's defaults. */
export async function status(raw?: string | null) {
  const tried = raw ? [baseUrl(raw)] : [...new Set([baseUrl(null), ...DEFAULTS])];
  for (const u of tried) {
    try { const j = await call(`${u}/models`, {}, 3000) as { data?: { id: string }[] }; return { url: u, online: true, models: (j.data ?? []).map(m => m.id).filter(Boolean).sort(), model: process.env.CT_LLM_MODEL ?? null } }
    catch { /* next */ }
  }
  return { url: tried[0], online: false, models: [] as string[], model: process.env.CT_LLM_MODEL ?? null };
}
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }
export async function chat(body: unknown) {
  const b = (body ?? {}) as { url?: string; model?: string; messages?: Msg[]; temperature?: number };
  const model = String(b.model || process.env.CT_LLM_MODEL || '').trim();
  if (!model || model.length > 200) throw bad('Pick a model');
  const msgs = Array.isArray(b.messages) ? b.messages.filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string') : [];
  if (!msgs.length || msgs.length > 60 || msgs.reduce((a, m) => a + m.content.length, 0) > 200_000) throw bad('Messages: 1 to 60, under 200k characters');
  const t = Number.isFinite(b.temperature) ? Math.min(2, Math.max(0, Number(b.temperature))) : 0.3;
  const j = await call(`${baseUrl(b.url)}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: msgs, temperature: t, stream: false }) }, 300_000) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
  const text = j.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new HttpError(502, 'The model returned no answer');
  return { text: text.replace(/<think>[\s\S]*?<\/think>\s*/g, ''), model, usage: j.usage ?? null };   // reasoning models wrap their thoughts in <think>
}
route('GET', '/api/ai/status', c => status(c.url.searchParams.get('url')));
route('POST', '/api/ai/chat', c => chat(c.body), { limit: 400_000 });
