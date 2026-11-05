// Strict validation of AlertInput coming from clients (another device may send anything).
import type { AlertInput, AlertSource, Channel, LineRef, ScriptSource } from '../../src/alerttypes.ts';
import { validTf } from '../../src/data.ts';
import { bad, obj } from '../core/http.ts';
import { EX_RE, SYM_RE } from '../market.ts';
import { IRAN } from '../iran/index.ts';
import { isExchange } from '../ccxt.ts';
import { CONDITIONS, FREQUENCIES, isChannel, isMoving } from './evaluate.ts';
import { isPublic } from '../core/mode.ts';

// Script compilers are loaded on a private server only: a public one never has them in its process.
const PE = isPublic ? null : await import('../../src/pine/engine.ts'), SS = isPublic ? null : await import('../scriptsource.ts'), SC = isPublic ? null : await import('../scripts.ts');
const PUBLIC_CHANNELS: Channel[] = ['popup', 'push'];

const CHANNELS: Channel[] = ['popup', 'push', 'telegram', 'email', 'webhook'];
const KEYS = new Set(['name', 'sym', 'tf', 'source', 'condition', 'value', 'value2', 'bars', 'frequency', 'expires', 'channels', 'webhook', 'message', 'active', 'autoStop']);
const MAX_NUM = 1e15;

const num = (x: unknown, what: string) => { if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > MAX_NUM) throw bad(`Bad ${what}`); return x };
const int = (x: unknown, what: string, lo: number, hi: number) => { if (!Number.isInteger(x) || (x as number) < lo || (x as number) > hi) throw bad(`${what} must be an integer ${lo}–${hi}`); return x as number };
const str = (x: unknown, what: string, max: number) => { if (typeof x !== 'string' || x.length > max) throw bad(`Bad ${what}`); return x };
const optBool = (x: unknown, what: string) => { if (x !== undefined && typeof x !== 'boolean') throw bad(`Bad ${what}`); return x as boolean | undefined };

export function validSym(sym: unknown): string {
  const m = typeof sym === 'string' ? /^(?:([A-Z0-9]{2,30}):)?([A-Z0-9_.\u0600-\u06FF]{1,40})$/.exec(sym) : null;
  if (!m || !SYM_RE.test(m[2])) throw bad('Bad symbol');
  if (m[1] && m[1] !== 'BINANCE') {
    const ex = m[1].toLowerCase();
    if (!EX_RE.test(ex) || (ex !== 'fx' && !IRAN[ex] && !isExchange(ex))) throw bad('Unknown exchange');
  }
  return sym as string;
}

function script(x: unknown) {
  const src = str(x, 'script', 200_000);
  if (!src.trim()) throw bad('Script is empty');
  const p = PE!.compile(src);
  if (PE!.isError(p)) throw bad(`Script error (line ${p.line}): ${p.msg}`);
  return src;
}
/** MQL / NinjaScript: sources only, compiled here once so a broken script is refused up front. */
function code(x: unknown, sym: unknown, tf: unknown): ScriptSource | undefined {
  if (x === undefined) return undefined;
  const c = SS!.validSource(obj(x, 'code'));
  if (c.lang === 'pine') throw bad('Pine goes in script');
  try { SC!.buildJob(c, String(sym), String(tf)) } catch (e) { throw bad(`Script error: ${(e as Error).message}`) }
  return c;
}
function inputs(x: unknown) {
  if (x === undefined) return undefined;
  const o = obj(x, 'inputs'), keys = Object.keys(o);
  if (keys.length > 100) throw bad('Too many inputs');
  for (const k of keys) {
    const v = o[k];
    if (k.length > 100 || !(typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 1000))) throw bad(`Bad input ${k.slice(0, 100)}`);
  }
  return o;
}
function line(x: unknown, what: string): LineRef {
  const l = obj(x, what);
  if (l.type === 'hline') return { type: 'hline', price: num(l.price, `${what}.price`) };
  if (l.type !== 'trend') throw bad(`Bad ${what}.type`);
  const t1 = num(l.t1, `${what}.t1`), t2 = num(l.t2, `${what}.t2`);
  if (t1 === t2) throw bad(`${what}: t1 and t2 must differ`);
  const out: LineRef = { type: 'trend', t1, p1: num(l.p1, `${what}.p1`), t2, p2: num(l.p2, `${what}.p2`) };
  const el = optBool(l.extendLeft, 'extendLeft'), er = optBool(l.extendRight, 'extendRight');
  if (el !== undefined) out.extendLeft = el;
  if (er !== undefined) out.extendRight = er;
  return out;
}
function source(x: unknown, sym: unknown, tf: unknown): AlertSource {
  const s = obj(x, 'source');
  if (isPublic && ((s.kind !== 'price' && s.kind !== 'drawing') || s.code !== undefined)) throw bad('Only price and drawing-line alerts are available on this server; indicator and script alerts need your own private server');
  const cd = code(s.code, sym, tf);
  // MQL / NinjaScript: `script` is just the main file (for display); `code` is what runs.
  const scr = (v: unknown) => cd ? str(v, 'script', 1024 * 1024) : script(v);
  switch (s.kind) {
    case 'price': return { kind: 'price' };
    case 'indicator': return { kind: 'indicator', script: scr(s.script), ...(cd ? { code: cd } : {}), inputs: inputs(s.inputs), plot: int(s.plot ?? 0, 'plot', 0, 63) };
    case 'drawing': {
      const out: AlertSource = { kind: 'drawing', line: line(s.line, 'line') };
      if (s.drawingId !== undefined) out.drawingId = str(s.drawingId, 'drawingId', 100);
      if (s.line2 !== undefined) out.line2 = line(s.line2, 'line2');
      return out;
    }
    case 'script': {
      if (s.event !== 'alertcondition' && s.event !== 'alert' && s.event !== 'strategy') throw bad('Bad script event');
      const out: AlertSource = { kind: 'script', script: scr(s.script), ...(cd ? { code: cd } : {}), inputs: inputs(s.inputs), event: s.event };
      if (s.event === 'alertcondition') out.index = int(s.index ?? 0, 'index', 0, 63);
      return out;
    }
    default: throw bad('Bad source kind');
  }
}

/** Validate a full AlertInput (for PUT, merge the stored input with the patch first). Returns a clean copy. */
export function validateInput(x: unknown, now = Date.now()): AlertInput {
  const b = obj(x, 'Alert');
  for (const k of Object.keys(b)) if (!KEYS.has(k)) throw bad(`Unknown field ${k.slice(0, 40)}`);
  const tf = str(b.tf, 'tf', 6);
  if (!validTf(tf) || +tf.slice(0, -1) > 1000) throw bad('Bad timeframe');
  if (!FREQUENCIES.includes(b.frequency as never)) throw bad('Bad frequency');
  const src = source(b.source, b.sym, tf);
  const a: AlertInput = { sym: validSym(b.sym), tf, source: src, frequency: b.frequency as AlertInput['frequency'], channels: [], message: '', active: true };

  if (b.name !== undefined && b.name !== '') a.name = str(b.name, 'name', 100).trim() || undefined;
  if (a.name === undefined) delete a.name;
  if (src.kind !== 'script') {
    if (!CONDITIONS.includes(b.condition as never)) throw bad('Bad condition');
    const c = a.condition = b.condition as AlertInput['condition'];
    if (b.value !== undefined) a.value = num(b.value, 'value');
    if (b.value2 !== undefined) a.value2 = num(b.value2, 'value2');
    if (isMoving(c)) {
      if (src.kind === 'drawing') throw bad('Moving conditions need a price or indicator source');
      if (a.value === undefined || a.value < 0) throw bad('Moving conditions need a non-negative value');
      if (b.bars !== undefined) a.bars = int(b.bars, 'bars', 1, 1000);
    } else if (isChannel(c)) {
      if (src.kind === 'drawing' ? !src.line2 : a.value === undefined || a.value2 === undefined) throw bad('Channel conditions need two bounds');
    } else if (src.kind !== 'drawing' && a.value === undefined) throw bad('Condition needs a value');
  } else if (b.condition !== undefined) throw bad('Script alerts take no condition');

  if (b.expires !== undefined && b.expires !== null) a.expires = num(b.expires, 'expires');
  else if (b.expires === null) a.expires = null;
  if (!Array.isArray(b.channels) || b.channels.length > CHANNELS.length || b.channels.some(c => !CHANNELS.includes(c))) throw bad('Bad channels');
  a.channels = [...new Set(b.channels as Channel[])];
  if (isPublic && (a.channels.some(c => !PUBLIC_CHANNELS.includes(c)) || b.webhook !== undefined)) throw bad('Only the in-app popup and push notifications are available on this server');
  if (b.webhook !== undefined) {
    const w = obj(b.webhook, 'webhook'), url = str(w.url, 'webhook url', 2000);
    let u: URL;
    try { u = new URL(url) } catch { throw bad('Bad webhook url') }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Webhook url must be http or https');
    a.webhook = { url };
    if (w.body !== undefined) a.webhook.body = str(w.body, 'webhook body', 20_000);
  }
  if (b.message !== undefined) a.message = str(b.message, 'message', 5000);
  if (b.active !== undefined) a.active = optBool(b.active, 'active')!;
  if (b.autoStop !== undefined) {
    const s = obj(b.autoStop, 'autoStop');
    a.autoStop = { count: int(s.count, 'autoStop.count', 1, 1000), minutes: int(s.minutes, 'autoStop.minutes', 1, 1440) };
  }
  if (a.active && a.expires != null && a.expires <= now) throw bad('Expiration is in the past');
  return a;
}
