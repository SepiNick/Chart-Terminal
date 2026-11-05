// Merge of this device's synced data with an account's data (docs/research/oauth-sync-design.md §4). Pure: no DOM, no
// storage, no network, so node tests cover it. Rules per key come from SCHEMA; unknown keys fall back to a generic rule.
// Guarantees: nothing is dropped unless it carries a tombstone newer than its last edit; merging twice gives the same
// result (idempotent); it is symmetric except for the stated tie rule "account wins".
//
// Sidecar `syncmeta` (a synced key, written by store.set through stampChange): per-item edit/delete stamps for tombstones
// and per-field stamps for last-writer-wins. Without stamps nothing is deleted and scalars follow "account wins, gaps filled".

export interface Stamp { u?: number; d?: number }
export interface Meta { items: Record<string, Record<string, Stamp>>; fields: Record<string, Record<string, number>> }
export const emptyMeta = (): Meta => ({ items: {}, fields: {} });
export const DAY = 86_400_000;
export const TOMB_DAYS = 90, TOMB_MAX = 5000, STAMP_MAX = 20_000;

type Any = any;   // values are untyped JSON from two untrusted sides; every access below is guarded
type Fn = (x: Any) => string;
export type Node =
  | { k: 'set'; cap?: number }
  | { k: 'doc' } | { k: 'ledger' }
  | { k: 'obj'; kids?: Record<string, Node> }
  | { k: 'ids'; idOf: Fn; join?: (a: Any, d: Any) => Any; dupKey?: Fn; reid?: boolean }
  | { k: 'rec'; each: 'rename' | 'script' | 'text' | Node };

const set = (cap?: number): Node => ({ k: 'set', cap });
const obj = (kids?: Record<string, Node>): Node => ({ k: 'obj', kids });
const byId: Fn = x => String(x?.id);
const noId = (x: Any) => JSON.stringify({ ...x, id: 0 });
const fillKey = (f: Any) => `${f?.t}|${f?.side}|${f?.qty}|${f?.px}`;
const tradeEnd = (t: Any) => Number(t?.closeTime ?? t?.openTime ?? 0);
function joinTrade(a: Any, d: Any) {
  const base = tradeEnd(d) > tradeEnd(a) ? d : a;
  const fills = new Map<string, Any>();
  for (const f of [...(a?.fills ?? []), ...(d?.fills ?? [])]) if (!fills.has(fillKey(f))) fills.set(fillKey(f), f);
  return Array.isArray(base.fills) ? { ...base, fills: [...fills.values()].sort((x, y) => x.t - y.t) } : base;
}
const joinNote = (a: Any, d: Any) => (Number(d?.updated ?? 0) > Number(a?.updated ?? 0) ? d : a);

export const SCHEMA: Record<string, Node> = {
  journal: obj({
    trades: { k: 'ids', idOf: byId, join: joinTrade, dupKey: t => `${t.sym}|${t.dir}|${t.openTime}|${t.avgEntry}|${t.qty}` },
    notes: { k: 'rec', each: 'text' },
    setups: set(), entryReasons: set(), exitReasons: set(), motives: set(), questions: set(), tagList: set(),
    accounts: { k: 'ids', idOf: byId }, checklists: { k: 'ids', idOf: byId }, fields: { k: 'ids', idOf: byId }, props: { k: 'ids', idOf: byId },
    docs: { k: 'ids', idOf: byId, join: joinNote },
    brokerSeen: { k: 'rec', each: set() },
  }),
  layouts: { k: 'rec', each: 'rename' }, layout: { k: 'doc' }, layoutName: { k: 'doc' }, autosave: { k: 'doc' },
  drawings: { k: 'rec', each: { k: 'ids', idOf: byId, dupKey: noId, reid: true } },
  scripts: { k: 'rec', each: 'script' },
  indTemplates: { k: 'rec', each: 'rename' }, chartTemplates: { k: 'rec', each: 'rename' }, drawTemplates: { k: 'rec', each: 'rename' },
  watch: set(), favTfs: set(), customTfs: set(), favTools: set(), recentSymbols: set(12),
  alerts: { k: 'ids', idOf: byId, dupKey: noId, reid: true },
  acct: { k: 'ledger' },
};
/** Keys that hold user content (counted in the dialog; a device with none of them is "empty"). */
const CONTENT = ['journal', 'watch', 'layouts', 'scripts', 'drawings', 'indTemplates', 'chartTemplates', 'drawTemplates', 'alerts'];
/** Keys that must never leave the device or be merged (secrets, per-device bindings). Merge refuses them even if passed in. */
export const NEVER = new Set(['ctsrv', 'ctoauth', 'ctown', 'aiUrl', 'brokerActive']);

const isObj = (x: unknown): x is Record<string, Any> => !!x && typeof x === 'object' && !Array.isArray(x);
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

function nodeFor(key: string, v: unknown): Node {
  return SCHEMA[key] ?? (isObj(v) ? obj() : Array.isArray(v) && v.length && v.every(x => typeof x === 'string') ? set() : { k: 'doc' });
}

// ---------- metadata ----------
export function mergeMeta(a: Meta | undefined, b: Meta | undefined): Meta {
  const out = emptyMeta();
  for (const m of [a, b]) {
    if (!isObj(m)) continue;
    for (const [p, ids] of Object.entries(m.items ?? {})) for (const [id, s] of Object.entries(ids ?? {})) {
      const o = ((out.items[p] ??= {})[id] ??= {});
      if (s?.u !== undefined) o.u = Math.max(o.u ?? 0, s.u);
      if (s?.d !== undefined) o.d = Math.max(o.d ?? 0, s.d);
    }
    for (const [p, fs] of Object.entries(m.fields ?? {})) for (const [f, t] of Object.entries(fs ?? {})) { const o = (out.fields[p] ??= {}); o[f] = Math.max(o[f] ?? 0, Number(t) || 0) }
  }
  return out;
}
/** Forget old tombstones (90 days, 5,000 max, oldest first) and cap the edit stamps. */
export function pruneMeta(m: Meta, now: number): Meta {
  const tombs: [number, string, string][] = [];
  let stamps = 0;
  for (const [p, ids] of Object.entries(m.items)) for (const [id, s] of Object.entries(ids)) {
    if (s.d !== undefined && s.d < now - TOMB_DAYS * DAY) { if (s.u !== undefined && s.u > s.d) delete s.d; else delete ids[id]; continue }
    if (s.d !== undefined) tombs.push([s.d, p, id]);
    if (ids[id]) stamps++;
  }
  tombs.sort((x, y) => x[0] - y[0]);
  for (const [, p, id] of tombs.slice(0, Math.max(0, tombs.length - TOMB_MAX))) { delete m.items[p]?.[id]; stamps-- }
  if (stamps > STAMP_MAX) {   // drop the oldest edit-only stamps; an item without a stamp just counts as "never edited"
    const edits = Object.entries(m.items).flatMap(([p, ids]) => Object.entries(ids).filter(([, s]) => s.d === undefined).map(([id, s]) => [s.u ?? 0, p, id] as const)).sort((x, y) => x[0] - y[0]);
    for (const [, p, id] of edits.slice(0, stamps - STAMP_MAX)) delete m.items[p]?.[id];
  }
  for (const p of Object.keys(m.items)) if (!Object.keys(m.items[p]).length) delete m.items[p];
  return m;
}

// ---------- merge ----------
export interface Ctx { a: Meta; d: Meta; notes: string[]; acct: 'account' | 'device' }
const dead = (c: Ctx, path: string, id: string) => {
  const sa = c.a.items[path]?.[id], sd = c.d.items[path]?.[id];
  return Math.max(sa?.d ?? 0, sd?.d ?? 0) > Math.max(sa?.u ?? 0, sd?.u ?? 0);
};
const fieldStamp = (m: Meta, path: string, f: string) => m.fields[path]?.[f] ?? 0;
const sfx = 'this device';

function mergeNode(n: Node, a: Any, d: Any, c: Ctx, path: string): Any {
  if (a === undefined) a = n.k === 'set' || n.k === 'ids' ? undefined : a;
  switch (n.k) {
    case 'doc': {
      if (a === undefined) return d; if (d === undefined || same(a, d)) return a;
      return fieldStamp(c.d, path, '*') > fieldStamp(c.a, path, '*') ? d : a;
    }
    case 'ledger': {
      if (a === undefined) return d; if (d === undefined) return a;
      return c.acct === 'device' ? d : a;
    }
    case 'set': {
      if ((a !== undefined && !Array.isArray(a)) || (d !== undefined && !Array.isArray(d))) return a ?? d;
      const out: Any[] = [];
      for (const x of [...(a ?? []), ...(d ?? [])]) if (!out.includes(x) && !(typeof x === 'string' && dead(c, path, x))) out.push(x);
      return n.cap ? out.slice(0, n.cap) : out;
    }
    case 'ids': return mergeIds(n, a, d, c, path);
    case 'rec': return mergeRec(n, a, d, c, path);
    case 'obj': {
      if (!isObj(a) || !isObj(d)) return a === undefined ? d : a;
      const out: Record<string, Any> = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) {
        const kid = n.kids?.[k], ia = k in a, id = k in d;
        if (kid) { const v = mergeNode(kid, a[k], d[k], c, `${path}/${k}`); if (v !== undefined) out[k] = v }
        else if (!id) out[k] = a[k];
        else if (!ia || same(a[k], d[k])) out[k] = id && !ia ? d[k] : a[k];
        else out[k] = fieldStamp(c.d, path, k) > fieldStamp(c.a, path, k) ? d[k] : a[k];
      }
      return out;
    }
  }
}

function mergeIds(n: Extract<Node, { k: 'ids' }>, a: Any, d: Any, c: Ctx, path: string): Any {
  if ((a !== undefined && !Array.isArray(a)) || (d !== undefined && !Array.isArray(d))) return a ?? d;
  const A: Any[] = a ?? [], D: Any[] = d ?? [], out = new Map<string, Any>();
  for (const x of A) { const id = n.idOf(x); if (!dead(c, path, id) && !out.has(id)) out.set(id, x) }
  const accDup = new Set(n.dupKey ? A.map(n.dupKey) : []);
  for (const y of D) {
    const id = n.idOf(y);
    if (dead(c, path, id)) continue;
    const ex = out.get(id);
    if (ex !== undefined && same(ex, y)) continue;
    if ((ex === undefined || n.reid) && n.dupKey && accDup.has(n.dupKey(y))) continue;   // the same thing recorded on both sides under another id
    if (ex === undefined) { out.set(id, y); continue }
    if (n.reid) {
      let nid = Number(id); do nid++; while ([...out.keys()].includes(String(nid)));
      out.set(String(nid), { ...y, id: nid }); c.notes.push(`An item from this device got a new id (${id} -> ${nid}) because the account already had a different one with that id`);
    } else out.set(id, n.join ? n.join(ex, y) : ex);
  }
  return [...out.values()];
}

function mergeRec(n: Extract<Node, { k: 'rec' }>, a: Any, d: Any, c: Ctx, path: string): Any {
  if (!isObj(a) || !isObj(d)) return a === undefined ? d : a;
  const out: Record<string, Any> = {};
  for (const k of [...Object.keys(a), ...Object.keys(d)]) if (!(k in out) && !dead(c, path, k)) {
    const ia = k in a, id = k in d;
    if (!(ia && id)) { out[k] = ia ? a[k] : d[k]; continue }
    if (same(a[k], d[k])) { out[k] = a[k]; continue }
    const e = n.each;
    if (e === 'text') out[k] = typeof a[k] !== 'string' || typeof d[k] !== 'string' ? a[k] : a[k].includes(d[k]) ? a[k] : d[k].includes(a[k]) ? d[k] : `${a[k]}\n---\n${d[k]}`;
    else if (e === 'rename') out[k] = a[k];
    else if (e === 'script') out[k] = Number(d[k]?.updated ?? 0) > Number(a[k]?.updated ?? 0) ? d[k] : a[k];
    else out[k] = mergeNode(e, a[k], d[k], c, `${path}/${k}`);
  }
  // Loser copies for the two "keep both" kinds, added after the main pass so the main keys keep their order.
  if (n.each === 'rename' || n.each === 'script') for (const k of Object.keys(a)) if (k in d && !same(a[k], d[k])) {
    const loser: Any = n.each === 'script' && Number(d[k]?.updated ?? 0) > Number(a[k]?.updated ?? 0) ? a[k] : d[k];
    if (dead(c, path, k)) continue;
    const label = n.each === 'rename' ? `${k} (${sfx})` : `${k}.dev${loser?.updated ?? ''}`;
    const eq = (x: Any) => same(n.each === 'rename' ? x : { ...x, id: 0, name: 0 }, n.each === 'rename' ? loser : { ...loser, id: 0, name: 0 });
    let name = label, i = 2; while (name in out && !eq(out[name])) name = `${label} ${i++}`;
    if (name in out) continue;
    if (n.each === 'rename') out[name] = loser;
    else out[name] = { ...loser, id: name, name: `${loser?.name ?? k} (other version, ${new Date(Number(loser?.updated) || 0).toISOString().slice(0, 10)})` };
    c.notes.push(`"${k}" differs on both sides: the other copy was kept as "${name}"`);
  }
  return out;
}

export interface MergeOpts { accMeta?: Meta; devMeta?: Meta; now?: number; acct?: 'account' | 'device' }
export interface MergeResult { values: Record<string, unknown>; meta: Meta; notes: string[] }
/** Merge two snapshots (key -> value). `syncmeta` is handled here; secrets and device-only keys are skipped. */
export function mergeAll(account: Record<string, unknown>, device: Record<string, unknown>, o: MergeOpts = {}): MergeResult {
  const c: Ctx = { a: o.accMeta ?? emptyMeta(), d: o.devMeta ?? emptyMeta(), notes: [], acct: o.acct ?? 'account' };
  const values: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(account), ...Object.keys(device)])) {
    if (k === 'syncmeta' || NEVER.has(k)) continue;
    const a = clone(account[k]), d = clone(device[k]);
    const v = mergeNode(nodeFor(k, a ?? d), a, d, c, k);
    if (v !== undefined) values[k] = v;
  }
  return { values, meta: pruneMeta(mergeMeta(c.a, c.d), o.now ?? Date.now()), notes: c.notes };
}
/** The paper account to keep by default: the side whose latest fill is newer (account on ties or when neither has fills). */
export function newerAcct(account: unknown, device: unknown): 'account' | 'device' {
  const last = (x: Any) => (isObj(x) && Array.isArray(x.fills) ? Math.max(0, ...x.fills.map((f: Any) => Number(f?.ts) || 0)) : 0);
  return last(device) > last(account) ? 'device' : 'account';
}

// ---------- summary for the dialog ----------
export interface Summary { trades: number; watch: number; layouts: number; scripts: number; drawings: number; templates: number; alerts: number; total: number; cash?: number; fills: number }
const len = (x: unknown) => (Array.isArray(x) ? x.length : isObj(x) ? Object.keys(x).length : 0);
export function summarize(s: Record<string, unknown>): Summary {
  const j = s.journal as Any, sum = (r: unknown) => (isObj(r) ? Object.values(r).reduce((n: number, v) => n + len(v), 0) : 0);
  const out = {
    trades: len(j?.trades), watch: len(s.watch), layouts: len(s.layouts), scripts: len(s.scripts), drawings: sum(s.drawings),
    templates: len(s.indTemplates) + len(s.chartTemplates) + len(s.drawTemplates), alerts: len(s.alerts), total: 0,
    cash: typeof (s.acct as Any)?.cash === 'number' ? (s.acct as Any).cash : undefined, fills: len((s.acct as Any)?.fills),
  };
  out.total = out.trades + out.watch + out.layouts + out.scripts + out.drawings + out.templates + out.alerts + len(j?.notes) + len(j?.docs);
  return out;
}
/** No content of its own: a fresh browser, or one that was only opened. Preferences alone don't count. */
export const isEmptyDevice = (s: Record<string, unknown>) => summarize(s).total === 0 && summarize(s).fills === 0 && !CONTENT.some(k => k !== 'journal' && len(s[k]) > 0);

// ---------- stamping (called by store.set) ----------
export const hasSchema = (key: string) => key !== 'syncmeta' && !NEVER.has(key);
/** Record edits/deletes between two values of one key into `m` (mutates). */
export function stampChange(m: Meta, key: string, oldV: unknown, newV: unknown, now: number) {
  if (hasSchema(key)) stampNode(nodeFor(key, newV ?? oldV), oldV, newV, key, m, now);
}
function st(m: Meta, path: string, id: string, patch: Stamp) { Object.assign(((m.items[path] ??= {})[id] ??= {}), patch) }
function stampNode(n: Node, o: Any, v: Any, path: string, m: Meta, now: number) {
  if (same(o, v)) return;
  switch (n.k) {
    case 'ledger': return;
    case 'doc': (m.fields[path] ??= {})['*'] = now; return;
    case 'set': {
      const oo: Any[] = Array.isArray(o) ? o : [], nn: Any[] = Array.isArray(v) ? v : [];
      for (const x of nn) if (typeof x === 'string' && !oo.includes(x)) st(m, path, x, { u: now });
      for (const x of oo) if (typeof x === 'string' && !nn.includes(x)) st(m, path, x, { d: now });
      return;
    }
    case 'ids': {
      const oo = new Map<string, Any>((Array.isArray(o) ? o : []).map((x: Any) => [n.idOf(x), x])), nn = new Map<string, Any>((Array.isArray(v) ? v : []).map((x: Any) => [n.idOf(x), x]));
      for (const [id, x] of nn) if (!oo.has(id) || !same(oo.get(id), x)) st(m, path, id, { u: now });
      for (const id of oo.keys()) if (!nn.has(id)) st(m, path, id, { d: now });
      return;
    }
    case 'rec': {
      const oo = isObj(o) ? o : {}, nn = isObj(v) ? v : {};
      for (const k of Object.keys(nn)) if (!(k in oo) || !same(oo[k], nn[k])) {
        st(m, path, k, { u: now });
        if (typeof n.each === 'object') stampNode(n.each, oo[k], nn[k], `${path}/${k}`, m, now);
      }
      for (const k of Object.keys(oo)) if (!(k in nn)) st(m, path, k, { d: now });
      return;
    }
    case 'obj': {
      const oo = isObj(o) ? o : {}, nn = isObj(v) ? v : {};
      for (const k of new Set([...Object.keys(oo), ...Object.keys(nn)])) {
        if (same(oo[k], nn[k])) continue;
        const kid = n.kids?.[k];
        if (kid) stampNode(kid, oo[k], nn[k], `${path}/${k}`, m, now);
        else (m.fields[path] ??= {})[k] = now;
      }
    }
  }
}

// ---------- which side owns this browser's data (§4.2) ----------
export interface Owner { server: string; userId: string; at: number }
type Kv = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const OWNER_KEY = 'ctown';   // not `ct.*`: never synced
export function readOwner(ls: Kv): Owner | null {
  try { const o = JSON.parse(ls.getItem(OWNER_KEY) ?? 'null'); return o && typeof o.server === 'string' && typeof o.userId === 'string' ? o : null } catch { return null }
}
export function writeOwner(ls: Kv, server: string, userId: string, at = Date.now()) { try { ls.setItem(OWNER_KEY, JSON.stringify({ server, userId, at })) } catch {} }
export type Plan = 'hydrate' | 'upload' | 'foreign' | 'match';
/**
 * What to do right after sign-in. `hydrate` is the only destructive plan (replaces this browser with the account), so it is
 * chosen only when nothing here is worth keeping or this browser already is this account's copy. Data that belongs to
 * another account is never offered for upload without asking (even when this account is empty).
 */
export function planMatch(i: { deviceEmpty: boolean; accountEmpty: boolean; own: Owner | null; server: string; userId: string }): Plan {
  if (i.deviceEmpty) return 'hydrate';
  if (i.own && (i.own.server !== i.server || i.own.userId !== i.userId)) return 'foreign';
  if (i.own) return 'hydrate';
  return i.accountEmpty ? 'upload' : 'match';
}
