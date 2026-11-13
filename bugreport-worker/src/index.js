// Chart Terminal bug-report receiver (a Cloudflare Worker, plain Fetch API: no dependencies, no build step).
//   GET  /challenge  -> { salt, difficulty, exp, sig }   a proof-of-work puzzle (stateless: signed with CHALLENGE_SECRET)
//   POST /report     -> { ok, id }                       { description, contact?, info?, images?: [data URL], captcha: {salt, difficulty, exp, sig, n} }
// The app solves the puzzle first (find n so that SHA-256("<salt>:<n>") starts with `difficulty` zero bits), so a script cannot
// flood the bot for free. Then the report goes to your Telegram chat (text, diagnostics file, screenshots) and, if configured, into
// a GitHub issue (text only: no contact address, no images). Limits: body size, reports per IP per hour, reports per day.
// Secrets: TELEGRAM_BOT_TOKEN, CHALLENGE_SECRET, GITHUB_TOKEN (optional). Vars: TELEGRAM_CHAT_ID, GITHUB_REPO (optional),
// DIFFICULTY (default 16), IP_PER_HOUR (default 5), PER_DAY (default 300). KV binding LIMITS (optional): replay guard and the limits.

const enc = new TextEncoder();
export const MAX_BODY = 9 * 1024 * 1024, MAX_IMAGES = 3, MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const fail = (status, error) => json({ error }, status);

const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 };
export const zeroBits = u8 => { let n = 0; for (const b of u8) { if (b === 0) { n += 8; continue } return n + Math.clz32(b) - 24 } return n };
export async function powOk(salt, n, difficulty) { return zeroBits(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${n}`)))) >= difficulty }

const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

export async function challenge(env, now = Date.now()) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16))), difficulty = num(env.DIFFICULTY, 16), exp = now + 10 * 60_000;
  return { salt, difficulty, exp, sig: await hmac(env.CHALLENGE_SECRET, `${salt}.${difficulty}.${exp}`) };
}
/** True when the puzzle was issued by us, is not expired, and n solves it. */
export async function captchaOk(c, env, now = Date.now()) {
  if (!c || typeof c !== 'object' || typeof c.salt !== 'string' || !/^[0-9a-f]{32}$/.test(c.salt) || !Number.isInteger(c.n) || c.n < 0) return false;
  if (!Number.isInteger(c.difficulty) || c.difficulty < num(env.DIFFICULTY, 16) || !Number.isInteger(c.exp) || c.exp < now || typeof c.sig !== 'string') return false;
  if (!same(c.sig, await hmac(env.CHALLENGE_SECRET, `${c.salt}.${c.difficulty}.${c.exp}`))) return false;
  return powOk(c.salt, c.n, c.difficulty);
}

const IMG = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const text = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
/** Validates the report body; returns { error } for anything that is not a plain report. */
export function parseReport(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'Bad report' };
  const description = text(o.description, 5000);
  if (description.length < 5) return { error: 'Describe the problem (at least a few words)' };
  const raw = Array.isArray(o.images) ? o.images : [];
  if (raw.length > MAX_IMAGES) return { error: `At most ${MAX_IMAGES} images` };
  const images = [];
  for (const x of raw) {
    const m = typeof x === 'string' ? IMG.exec(x) : null;
    if (!m) return { error: 'Images must be jpeg, png or webp' };
    let bin; try { bin = atob(m[2]) } catch { return { error: 'Bad image' } }
    if (!bin.length || bin.length > MAX_IMAGE_BYTES) return { error: 'An image is empty or larger than 2 MB' };
    images.push({ mime: `image/${m[1]}`, ext: m[1] === 'jpeg' ? 'jpg' : m[1], bytes: Uint8Array.from(bin, ch => ch.charCodeAt(0)) });
  }
  return { description, contact: text(o.contact, 200), info: text(o.info, 20000), images };
}

/** Counts one use of `key` in KV for `ttl` seconds; false when the limit is already reached. Without KV there are no limits here. */
async function take(env, key, limit, ttl) {
  if (!env.LIMITS) return true;
  const n = Number(await env.LIMITS.get(key)) || 0;
  if (n >= limit) return false;
  await env.LIMITS.put(key, String(n + 1), { expirationTtl: ttl });
  return true;
}

async function telegram(env, id, r) {
  const call = async (method, form) => {
    form.set('chat_id', env.TELEGRAM_CHAT_ID);
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', body: form });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`Telegram ${method}: ${String(j.description ?? res.status).replaceAll(env.TELEGRAM_BOT_TOKEN, '***')}`);
  };
  const head = new FormData();
  head.set('text', `Bug report ${id}${r.contact ? `\nContact: ${r.contact}` : ''}${r.issueUrl ? `\nIssue: ${r.issueUrl}` : ''}\n\n${r.description}`.slice(0, 4000));
  await call('sendMessage', head);
  if (r.info) { const f = new FormData(); f.set('document', new Blob([r.info], { type: 'text/plain' }), `diagnostics-${id}.txt`); await call('sendDocument', f) }
  for (const [i, im] of r.images.entries()) { const f = new FormData(); f.set('photo', new Blob([im.bytes], { type: im.mime }), `screenshot-${i + 1}.${im.ext}`); await call('sendPhoto', f) }
}

/** Optional: an issue in a (private) repository. Text only; "@" is neutralised so a report cannot ping people. */
async function issue(env, id, r) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return '';
  const safe = s => s.replaceAll('@', '@​');
  const title = safe(r.description.split('\n')[0]).slice(0, 80) || `Bug report ${id}`;
  const body = `${safe(r.description)}\n\n<details><summary>Diagnostics</summary>\n\n\`\`\`\n${safe(r.info).replaceAll('```', "'''")}\n\`\`\`\n</details>\n\nReport ${id}. Screenshots and the contact address went to Telegram only.`;
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: 'POST', headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'chart-terminal-bugreport', 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, labels: ['bug-report'] }),
    });
    return res.ok ? String((await res.json()).html_url ?? '') : '';
  } catch { return '' }
}

/** The body as text, or null when it is larger than `max` bytes (checked as it streams in: HTTP/2 may omit content-length). */
async function readCapped(request, max) {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return '';
  const chunks = []; let n = 0;
  for await (const c of request.body) { n += c.length; if (n > max) return null; chunks.push(c) }
  return new TextDecoder().decode(Buffer_concat(chunks, n));
}
const Buffer_concat = (chunks, n) => { const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length } return out };

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.CHALLENGE_SECRET) return fail(500, 'Not configured');
  if (url.pathname === '/challenge' && request.method === 'GET') return json(await challenge(env, now));
  if (url.pathname !== '/report' || request.method !== 'POST') return fail(404, 'Not found');
  const body = await readCapped(request, MAX_BODY);
  if (body === null) return fail(413, 'Report too large');
  let o; try { o = JSON.parse(body) } catch { return fail(400, 'Bad JSON') }
  if (!(await captchaOk(o?.captcha, env, now))) return fail(403, 'Captcha failed or expired');
  const r = parseReport(o);
  if (r.error) return fail(400, r.error);
  if (!env.TELEGRAM_BOT_TOKEN || !/^-?\d{1,20}$/.test(String(env.TELEGRAM_CHAT_ID ?? ''))) return fail(500, 'Not configured');
  // one puzzle, one report; then the per-IP and per-day limits
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown', hour = Math.floor(now / 3_600_000), day = new Date(now).toISOString().slice(0, 10);
  if (!(await take(env, `used:${o.captcha.salt}`, 1, 900))) return fail(403, 'Captcha already used');
  if (!(await take(env, `ip:${ip}:${hour}`, num(env.IP_PER_HOUR, 5), 3600))) return fail(429, 'Too many reports from your address; try again later');
  if (!(await take(env, `day:${day}`, num(env.PER_DAY, 300), 86400))) return fail(429, 'Too many reports today; try again tomorrow');
  const id = `${day.replaceAll('-', '')}-${hex(crypto.getRandomValues(new Uint8Array(3)))}`;
  r.issueUrl = await issue(env, id, r);
  try { await telegram(env, id, r) } catch { return fail(502, 'Could not deliver the report') }
  return json({ ok: true, id });
}

export default { fetch: (request, env) => handle(request, env) };
