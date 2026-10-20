// Server alerts on the client (docs/phase5-contracts.md §9): create/edit dialog, side panel, log and popups.
// The top half is pure (tested in alertsui.test.ts); DOM work only happens inside functions.
import type { Alert, AlertInput, AlertLog, AlertSource, Channel, Condition, Frequency, LineRef } from './alerttypes.ts';
import type { Drawing, Pt } from './tools/types.ts';
import { $, esc, store, toast } from './store.ts';
import { api, onServer } from './sync.ts';

// ---------- pure helpers ----------
export interface OldAlert { id: number; sym: string; price: number; dir: 'up' | 'down'; on: boolean; drawingId?: number; note?: string }

const TREND_TOOLS = new Set(['trend', 'ray', 'extended', 'infoline', 'trendangle']);
const LEVEL_TOOLS = new Set(['hline', 'hray', 'crossline']);

function trendRef(a: Pt, b: Pt, extL: boolean, extR: boolean): LineRef | null {
  if (!a || !b || a.t === b.t) return null;
  if (a.t > b.t) [a, b, extL, extR] = [b, a, extR, extL];   // the server reads "left" as earlier in time
  return { type: 'trend', t1: a.t, p1: a.p, t2: b.t, p2: b.p, ...(extL ? { extendLeft: true } : {}), ...(extR ? { extendRight: true } : {}) };
}
/** Geometry of a drawing the server can evaluate at any time; channels give the upper edge as `line`. Null = unsupported tool. */
export function drawingLine(d: Drawing): { line: LineRef; line2?: LineRef } | null {
  const [a, b, c, e] = d.pts, L = !!d.style.extendLeft, R = !!d.style.extendRight;
  if (!a) return null;
  if (LEVEL_TOOLS.has(d.type)) return { line: { type: 'hline', price: a.p } };
  if (TREND_TOOLS.has(d.type)) { const l = trendRef(a, b, L, R); return l && { line: l } }
  if ((d.type === 'parallel' || d.type === 'fibchannel') && b && c && a.t !== b.t) {
    // Offset of the third point from the base line, measured linearly in time like the server evaluates.
    const off = c.p - (a.p + ((b.p - a.p) * (c.t - a.t)) / (b.t - a.t));
    const base = trendRef(a, b, L, R)!, other = trendRef({ t: a.t, p: a.p + off }, { t: b.t, p: b.p + off }, L, R)!;
    return off >= 0 ? { line: other, line2: base } : { line: base, line2: other };
  }
  if (d.type === 'flattop' && b && c) { const l = trendRef(a, b, L, R); return l && { line: l, line2: { type: 'hline', price: c.p } } }
  if (d.type === 'disjoint' && e) { const l = trendRef(a, b, L, R), l2 = trendRef(c, e, L, R); return l && l2 && { line: l, line2: l2 } }
  return null;
}

/** Old browser alerts (`alerts` state) → server alert inputs. Drawing alerts whose drawing is gone become price alerts. */
export function migrateOld(old: OldAlert[], drawings: Record<string, Drawing[]>, tf: string): AlertInput[] {
  return (Array.isArray(old) ? old : []).filter(a => a && typeof a.sym === 'string' && Number.isFinite(a.price)).map(a => {
    const d = a.drawingId != null ? drawings[a.sym]?.find(x => x.id === a.drawingId) : undefined, g = d ? drawingLine(d) : null;
    const dir = a.dir === 'down' ? 'down' : 'up';
    // The old engine compared against one edge only, so a migrated channel keeps just that edge.
    const source: AlertSource = g ? { kind: 'drawing', drawingId: String(d!.id), line: g.line } : { kind: 'price' };
    return {
      ...(a.note ? { name: a.note } : {}), sym: a.sym, tf, source, condition: dir === 'up' ? 'crossing_up' : 'crossing_down', ...(g ? {} : { value: a.price }),
      frequency: 'once', expires: null, channels: ['popup'], active: a.on !== false,
      message: `{{ticker}} crossing ${a.note ? a.note + ' ' : ''}${dir}${g ? '' : ' ' + a.price}`,
    } satisfies AlertInput;
  });
}

export const COND_LABEL: Record<Condition, string> = {
  crossing: 'Crossing', crossing_up: 'Crossing up', crossing_down: 'Crossing down', greater: 'Greater than', less: 'Less than',
  entering_channel: 'Entering channel', exiting_channel: 'Exiting channel', inside_channel: 'Inside channel', outside_channel: 'Outside channel',
  moving_up: 'Moving up', moving_down: 'Moving down', moving_up_pct: 'Moving up %', moving_down_pct: 'Moving down %',
};
export const FREQ_LABEL: Record<Frequency, string> = { once: 'Only once', once_per_bar: 'Once per bar', once_per_bar_close: 'Once per bar close', every_time: 'Every time', once_per_minute: 'Once per minute' };
const LINE_CONDS: Condition[] = ['crossing', 'crossing_up', 'crossing_down', 'greater', 'less'];
const CHANNEL_CONDS: Condition[] = ['entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel'];
const MOVING_CONDS: Condition[] = ['moving_up', 'moving_down', 'moving_up_pct', 'moving_down_pct'];
export function conditionsFor(src: AlertSource): Condition[] {
  if (src.kind === 'script') return [];
  if (src.kind === 'drawing') return src.line2 ? [...LINE_CONDS, ...CHANNEL_CONDS] : LINE_CONDS;
  return [...LINE_CONDS, ...CHANNEL_CONDS, ...MOVING_CONDS];
}
export const isChannel = (c?: Condition) => !!c && CHANNEL_CONDS.includes(c);
export const isMoving = (c?: Condition) => !!c && MOVING_CONDS.includes(c);

/** Raw values of the dialog. Numbers stay strings so validation can tell "empty" from "0". */
export interface AlertForm {
  name: string; sym: string; tf: string; source: AlertSource; condition?: Condition;
  value: string; value2: string; bars: string; frequency: Frequency; expires: string;   // expires: datetime-local value, '' = never
  message: string; channels: Channel[]; webhookUrl: string; webhookBody: string; active?: boolean;
}
const SYM_RE = /^([A-Z0-9]+:)?[A-Z0-9_.]{2,40}$/, TF_RE = /^[1-9]\d{0,3}[smhdwM]$/;
export function validateAlert(f: AlertForm, now = Date.now()): { input: AlertInput } | { error: string } {
  const sym = f.sym.trim().toUpperCase(), tf = f.tf.trim(), msg = f.message.trim(), num = (s: string) => (s.trim() === '' ? NaN : +s);
  if (!SYM_RE.test(sym)) return { error: 'Enter a valid symbol' };
  if (!TF_RE.test(tf)) return { error: 'Enter a valid interval, e.g. 1m, 15m, 4h, 1d' };
  if (f.name.length > 100) return { error: 'Name is too long (100 characters max)' };
  const out: AlertInput = { sym, tf, source: f.source, frequency: f.frequency, channels: [], message: msg, active: f.active ?? true, expires: null };
  if (f.name.trim()) out.name = f.name.trim();
  if (!FREQ_LABEL[f.frequency]) return { error: 'Choose a frequency' };
  if (f.source.kind !== 'script') {
    const c = f.condition;
    if (!c || !conditionsFor(f.source).includes(c)) return { error: 'Choose a condition for this source' };
    out.condition = c;
    if (isMoving(c)) {
      const v = num(f.value), n = num(f.bars || '1');
      if (!(v > 0)) return { error: 'Enter the amount to move (above 0)' };
      if (!Number.isInteger(n) || n < 1 || n > 500) return { error: 'Bars must be a whole number from 1 to 500' };
      out.value = v; out.bars = n;
    } else if (f.source.kind !== 'drawing') {
      const v = num(f.value);
      if (!Number.isFinite(v)) return { error: 'Enter a value' };
      if (isChannel(c)) {
        const v2 = num(f.value2);
        if (!Number.isFinite(v2)) return { error: 'Enter both channel bounds' };
        if (v === v2) return { error: 'The channel bounds must differ' };
        out.value = Math.min(v, v2); out.value2 = Math.max(v, v2);
      } else out.value = v;
    }
  }
  if (f.expires) {
    const t = Date.parse(f.expires);
    if (!Number.isFinite(t)) return { error: 'Invalid expiration date' };
    if (t <= now) return { error: 'Expiration must be in the future' };
    out.expires = t;
  }
  if (!msg) return { error: 'Enter a message' };
  if (msg.length > 4000) return { error: 'Message is too long (4000 characters max)' };
  out.channels = ['popup', ...new Set(f.channels.filter(c => c !== 'popup'))];
  if (out.channels.includes('webhook')) {
    const url = f.webhookUrl.trim();
    if (url) {
      let u: URL;
      try { u = new URL(url) } catch { return { error: 'Webhook URL is not valid' } }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Webhook URL must start with http:// or https://' };
    }
    if (f.webhookBody.length > 10000) return { error: 'Webhook body is too long' };
    if (url || f.webhookBody.trim()) out.webhook = { url, ...(f.webhookBody.trim() ? { body: f.webhookBody } : {}) };
  }
  return { input: out };
}

const fmtN = (v?: number) => (v == null ? '' : String(+v.toPrecision(10)));
export function describeSource(s: AlertSource): string {
  if (s.kind === 'price') return 'Price';
  if (s.kind === 'indicator') return `Indicator plot ${s.plot + 1}`;
  if (s.kind === 'drawing') return s.line2 ? 'Channel drawing' : s.line.type === 'hline' ? `Horizontal line ${fmtN(s.line.price)}` : 'Trend line';
  return s.event === 'alertcondition' ? `Script alertcondition ${(s.index ?? 0) + 1}` : s.event === 'alert' ? 'Script alert() calls' : 'Strategy orders';
}
/** One-line summary for the list, e.g. "Price · Crossing up 65000". */
export function describeAlert(a: Pick<Alert, 'source' | 'condition' | 'value' | 'value2' | 'bars'>): string {
  const c = a.condition, src = describeSource(a.source);
  if (a.source.kind === 'script' || !c) return src;
  const v = isMoving(c) ? `${fmtN(a.value)}${c.endsWith('pct') ? '%' : ''} in ${a.bars ?? 1} bar${(a.bars ?? 1) > 1 ? 's' : ''}`
    : isChannel(c) && a.source.kind !== 'drawing' ? `${fmtN(a.value)} – ${fmtN(a.value2)}` : a.source.kind === 'drawing' ? '' : fmtN(a.value);
  return `${src} · ${COND_LABEL[c]}${v ? ' ' + v : ''}`;
}
export type AlertStatus = 'active' | 'paused' | 'stopped';
export const alertStatus = (a: Pick<Alert, 'active' | 'stoppedReason'>): AlertStatus => (a.active ? 'active' : a.stoppedReason ? 'stopped' : 'paused');

/** The built-in chart indicators as Pine, so the server can evaluate them; plot order matches the legend. */
export const BUILTIN_PINE: Record<string, string> = Object.fromEntries(Object.entries({
  sma20: 'plot(ta.sma(close, 20), "SMA 20")', ema20: 'plot(ta.ema(close, 20), "EMA 20")', ema50: 'plot(ta.ema(close, 50), "EMA 50")', ema200: 'plot(ta.ema(close, 200), "EMA 200")',
  bb: '[b, u, l] = ta.bb(close, 20, 2)\nplot(u, "Upper")\nplot(b, "Basis")\nplot(l, "Lower")',
  vwap: 'plot(ta.vwap(hlc3), "VWAP")',
  donchian: 'u = ta.highest(high, 20)\nl = ta.lowest(low, 20)\nplot(u, "Upper")\nplot((u + l) / 2, "Basis")\nplot(l, "Lower")',
  rsi: 'plot(ta.rsi(close, 14), "RSI")',
  macd: '[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m, "MACD")\nplot(s, "Signal")\nplot(h, "Hist")',
  stoch: 'k = ta.stoch(close, high, low, 14)\nplot(k, "%K")\nplot(ta.sma(k, 3), "%D")',
  atr: 'plot(ta.atr(14), "ATR")', obv: 'plot(ta.obv, "OBV")',
}).map(([k, body]) => [k, `//@version=5\nindicator("${k}")\n${body}\n`]));

export const PLACEHOLDERS = ['ticker', 'exchange', 'interval', 'close', 'open', 'high', 'low', 'volume', 'time', 'timenow', 'plot_0', 'strategy.order.action', 'strategy.order.contracts', 'strategy.order.price', 'strategy.position_size'];

// ---------- client state ----------
/** What the active chart offers as alert sources; main.ts builds it. */
export interface AlertCtx {
  sym: string; tf: string; price: number | null; prec: number;
  drawings: Drawing[];
  plots: { label: string; name: string; script: string; inputs?: Record<string, unknown>; plot: number; last?: number }[];
  scripts: { id: string; name: string; src: string; inputs: Record<string, unknown>; conds: { title: string; message: string }[]; strategy: boolean }[];
  drawingName: (d: Drawing) => string;
}
export interface AlertsHost { ctx(): AlertCtx; changed(): void; beep(): void; toastMs(): number }
let host: AlertsHost;
let alerts: Alert[] = [], log: AlertLog[] = [];
export const serverAlerts = () => alerts;

async function loadAlerts() { try { alerts = await api<Alert[]>('/api/alerts'); host.changed(); renderAlertsPanel() } catch (e) { toast('Alerts: ' + (e as Error).message, 6000) } }
async function loadLog() { try { log = await api<AlertLog[]>('/api/alerts/log?limit=100'); renderAlertsPanel() } catch {} }
let logTimer = 0;

export function initServerAlerts(h: AlertsHost) {
  host = h;
  onServer('alerts', m => { if (Array.isArray(m.alerts)) { alerts = m.alerts as Alert[]; host.changed(); renderAlertsPanel() } });
  onServer('alert.fired', () => { clearTimeout(logTimer); logTimer = window.setTimeout(loadLog, 300) });
  onServer('notify', m => {
    const title = String(m.title ?? 'Alert'), body = String(m.body ?? '');
    toast(`⏰ ${title}${body ? ' — ' + body : ''}`, host.toastMs());
    if (m.sound !== false) host.beep();
    // Visible tab: the toast is enough. Hidden: a desktop notification (the tag lets a push for the same event replace it).
    try { if (document.hidden && Notification.permission === 'granted') new Notification(title, { body, tag: String(m.id ?? title) }) } catch {}
  });
  $('#alertNew').hidden = $('#alertLogClear').hidden = false; $('#alertPxRow').hidden = true;
  $('#alertNew').onclick = () => openAlertDialog();
  $('#alertLogClear').onclick = async () => { if (!log.length || !confirm('Clear the alert log?')) return; try { await api('/api/alerts/log', { method: 'DELETE' }); log = []; renderAlertsPanel() } catch (e) { toast((e as Error).message) } };
  $('#alertT').onclick = e => panelClick(e);
  wireDialog();
  loadAlerts(); loadLog();
}

/** Old browser alerts → server, then the caller clears the old key. Returns the alerts that failed. */
export async function migrateToServer(old: OldAlert[], drawings: Record<string, Drawing[]>, tf: string): Promise<OldAlert[]> {
  const failed: OldAlert[] = [], ins = migrateOld(old, drawings, tf);
  const valid = old.filter(a => a && typeof a.sym === 'string' && Number.isFinite(a.price));
  for (let i = 0; i < ins.length; i++) { try { await api('/api/alerts', { body: ins[i] }) } catch { failed.push(valid[i]) } }
  if (ins.length > failed.length) { toast(`Moved ${ins.length - failed.length} alert(s) to the server`); loadAlerts() }
  return failed;
}

// ---------- side panel ----------
const ago = (t?: number) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};
export function renderAlertsPanel() {
  if (!host) return;
  const rank = (a: Alert) => (a.active ? 0 : 1);
  const rows = [...alerts].sort((a, b) => rank(a) - rank(b) || b.created - a.created).map(a => {
    const s = alertStatus(a);
    return `<tr data-id="${esc(a.id)}"><td class="al-main"><b>${esc(a.name || a.sym)}</b>${a.name ? ` <span class="muted">${esc(a.sym)}</span>` : ''} <span class="muted">${esc(a.tf)}</span>
      <div class="muted">${esc(describeAlert(a))}</div>
      <div class="al-st"><span class="pill ${s}">${s === 'active' ? 'Active' : s === 'paused' ? 'Paused' : 'Stopped'}</span>${a.stoppedReason ? ` <span class="muted">${esc(a.stoppedReason)}</span>` : ''}
      <span class="muted" title="Last fired">· ${esc(ago(a.lastFired))} · ${a.fireCount}×</span></div></td>
      <td><button type="button" class="x" data-act="edit" title="Edit" aria-label="Edit alert">✎</button><button type="button" class="x" data-act="toggle" title="${a.active ? 'Pause' : 'Resume'}" aria-label="${a.active ? 'Pause' : 'Resume'} alert">${a.active ? '⏸' : '▶'}</button><button type="button" class="x" data-act="del" title="Delete" aria-label="Delete alert">×</button></td></tr>`;
  });
  $('#alertT').innerHTML = rows.join('') || '<tr><td class="muted" colspan="2">No alerts yet. Use ⏰ Alert, Alt+A or right-click the chart.</td></tr>';
  const name = (id: string) => { const a = alerts.find(x => x.id === id); return a ? a.name || a.sym : 'deleted alert' };
  $('#alertLog').innerHTML = log.slice(0, 100).map(l => `<div class="al-log"><div><span class="muted">${esc(new Date(l.at).toLocaleString())}</span> · <b>${esc(name(l.alertId))}</b>${l.price != null ? ` <span class="muted">@ ${esc(fmtN(l.price))}</span>` : ''}</div>
    <div>${esc(l.message)}</div><div class="chips">${(l.deliveries ?? []).map(d => `<span class="dlv ${d.ok ? 'ok' : 'bad'}" title="${esc(d.ok ? 'Delivered' : d.error ?? 'Failed')}">${d.ok ? '✓' : '✗'} ${esc(d.channel)}</span>`).join('')}</div></div>`).join('') || '<span class="muted">—</span>';
}
async function panelClick(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'), id = el?.closest<HTMLElement>('[data-id]')?.dataset.id;
  const a = alerts.find(x => x.id === id); if (!el || !a) return;
  try {
    if (el.dataset.act === 'edit') openAlertDialog({ edit: a });
    if (el.dataset.act === 'toggle') upsert(await api<Alert>(`/api/alerts/${encodeURIComponent(a.id)}`, { method: 'PUT', body: { active: !a.active } }));
    if (el.dataset.act === 'del' && confirm(`Delete the alert “${a.name || a.sym}”?`)) {
      await api(`/api/alerts/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      alerts = alerts.filter(x => x.id !== a.id); host.changed(); renderAlertsPanel();
    }
  } catch (err) { toast((err as Error).message, 5000) }
}
function upsert(a: Alert | undefined) {
  if (!a?.id) return loadAlerts();
  const i = alerts.findIndex(x => x.id === a.id);
  if (i >= 0) alerts[i] = a; else alerts.push(a);
  host.changed(); renderAlertsPanel();
}

// ---------- create / edit dialog ----------
interface SrcOpt { group: string; label: string; source: AlertSource; name?: string; value?: number; message?: string; key: string }
let opts: SrcOpt[] = [], editing: Alert | null = null, msgTouched = false, ctx: AlertCtx;

function sourceOptions(c: AlertCtx): SrcOpt[] {
  const o: SrcOpt[] = [{ group: '', label: 'Price', source: { kind: 'price' }, key: 'price' }];
  c.plots.forEach((p, i) => o.push({ group: 'Indicators', label: p.label, name: p.name, value: p.last, key: `plot:${i}`, source: { kind: 'indicator', script: p.script, ...(p.inputs ? { inputs: p.inputs } : {}), plot: p.plot } }));
  for (const d of c.drawings) {
    const g = drawingLine(d); if (!g) continue;
    o.push({ group: 'Drawings', label: c.drawingName(d), name: c.drawingName(d), key: `drawing:${d.id}`, source: { kind: 'drawing', drawingId: String(d.id), ...g } });
  }
  for (const s of c.scripts) {
    const base = { kind: 'script' as const, script: s.src, inputs: s.inputs };
    s.conds.forEach((x, i) => o.push({ group: s.name, label: `alertcondition: ${x.title}`, name: `${s.name} · ${x.title}`, message: x.message || undefined, key: `script:${s.id}:ac:${i}`, source: { ...base, event: 'alertcondition', index: i } }));
    o.push({ group: s.name, label: 'Any alert() call', name: s.name, message: '{{ticker}} {{interval}}: ' + s.name, key: `script:${s.id}:alert`, source: { ...base, event: 'alert' } });
    if (s.strategy) o.push({ group: s.name, label: 'Order fills', name: s.name, message: '{{strategy.order.action}} {{strategy.order.contracts}} {{ticker}} @ {{strategy.order.price}}', key: `script:${s.id}:strategy`, source: { ...base, event: 'strategy' } });
  }
  return o;
}

export interface DialogPreset { edit?: Alert; value?: number; drawingId?: number; scriptId?: string }
export function openAlertDialog(p: DialogPreset = {}) {
  ctx = host.ctx(); editing = p.edit ?? null; msgTouched = !!editing;
  opts = sourceOptions(ctx);
  let sel = 0;
  if (editing && editing.source.kind !== 'price') { opts.unshift({ group: '', label: `Current: ${describeSource(editing.source)}`, source: editing.source, key: 'current' }) }
  if (p.drawingId != null) {
    sel = opts.findIndex(o => o.key === `drawing:${p.drawingId}`);
    if (sel < 0) return toast('Alerts work on lines, rays, horizontal lines and channels');
  }
  if (p.scriptId) {
    sel = opts.findIndex(o => o.key.startsWith(`script:${p.scriptId}:`));
    if (sel < 0) return toast('Alerts on scripts need a Pine script that compiled on this chart');
  }
  const a = editing, px = p.value ?? ctx.price, prec = ctx.prec;
  const ch = new Set<Channel>(a?.channels ?? store.get<Channel[]>('alertChannels', ['popup']));
  const groups = [...new Set(opts.map(o => o.group))];
  $('#alDlgTitle').textContent = a ? `Edit alert · ${a.name || a.sym}` : 'Create alert';
  $('#alSubmit').textContent = a ? 'Save' : 'Create';
  $('#alSrc').innerHTML = groups.map(g => {
    const items = opts.map((o, i) => (o.group === g ? `<option value="${i}">${esc(o.label)}</option>` : '')).join('');
    return g ? `<optgroup label="${esc(g)}">${items}</optgroup>` : items;
  }).join('');
  $<HTMLSelectElement>('#alSrc').value = String(sel);
  $<HTMLInputElement>('#alSym').value = a?.sym ?? ctx.sym;
  $<HTMLInputElement>('#alTf').value = a?.tf ?? ctx.tf;
  $<HTMLSelectElement>('#alFreq').innerHTML = Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $<HTMLSelectElement>('#alFreq').value = a?.frequency ?? 'once';
  $<HTMLInputElement>('#alVal').value = a ? fmtN(a.value) : px != null ? px.toFixed(prec) : '';
  $<HTMLInputElement>('#alVal2').value = a ? fmtN(a.value2) : px != null ? (px * 1.01).toFixed(prec) : '';
  $<HTMLInputElement>('#alBars').value = String(a?.bars ?? 1);
  const exp = a?.expires;
  $<HTMLInputElement>('#alNever').checked = !exp;
  $<HTMLInputElement>('#alExp').value = exp ? localInput(exp) : localInput(Date.now() + 30 * 86400e3);
  $<HTMLInputElement>('#alName').value = a?.name ?? '';
  $<HTMLInputElement>('#alName').placeholder = opts[sel]?.name ?? (a ? '' : ctx.sym);
  $<HTMLTextAreaElement>('#alMsg').value = a?.message ?? '';
  for (const c of ['push', 'telegram', 'email', 'webhook'] as Channel[]) $<HTMLInputElement>(`#alCh-${c}`).checked = ch.has(c);
  $<HTMLInputElement>('#alHookUrl').value = a?.webhook?.url ?? '';
  $<HTMLTextAreaElement>('#alHookBody').value = a?.webhook?.body ?? '';
  $('#alErr').textContent = '';
  onSource(a?.condition);
  $<HTMLDialogElement>('#alertDlg').showModal();
  $<HTMLInputElement>(a || sel ? '#alName' : '#alVal').focus();
}
const localInput = (t: number) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16) };
const curOpt = () => opts[+$<HTMLSelectElement>('#alSrc').value] ?? opts[0];

/** Source changed: refill conditions (keeping the choice when possible), then show the fields it needs. */
function onSource(keep?: Condition) {
  const o = curOpt(), conds = conditionsFor(o.source), el = $<HTMLSelectElement>('#alCond');
  const prev = keep ?? (el.value as Condition);
  el.innerHTML = conds.map(c => `<option value="${c}">${esc(COND_LABEL[c])}</option>`).join('');
  el.value = conds.includes(prev) ? prev : conds[0] ?? '';
  if (!editing && o.value != null && o.source.kind === 'indicator') $<HTMLInputElement>('#alVal').value = (+o.value.toPrecision(8)).toString();
  if (!editing && o.source.kind === 'price' && ctx.price != null && !$<HTMLInputElement>('#alVal').value) $<HTMLInputElement>('#alVal').value = ctx.price.toFixed(ctx.prec);
  onCondition();
}
function onCondition() {
  const o = curOpt(), c = $<HTMLSelectElement>('#alCond').value as Condition, script = o.source.kind === 'script', drawing = o.source.kind === 'drawing';
  const show = (k: string, on: boolean) => { $(`#al${k}Row`).hidden = !on; $(`#al${k}Lbl`).hidden = !on };
  show('Cond', !script); show('Val', !script && (!drawing || isMoving(c))); show('Val2', !script && !drawing && isChannel(c)); show('Bars', !script && isMoving(c));
  $('#alValLbl').textContent = isMoving(c) ? (c.endsWith('pct') ? 'Move %' : 'Move by') : isChannel(c) ? 'Lower bound' : 'Value';
  $('#alHookRows').hidden = !$<HTMLInputElement>('#alCh-webhook').checked;
  $<HTMLInputElement>('#alExp').disabled = $<HTMLInputElement>('#alNever').checked;
  if (!msgTouched) $<HTMLTextAreaElement>('#alMsg').value = defaultMessage();
}
function defaultMessage() {
  const o = curOpt(), c = $<HTMLSelectElement>('#alCond').value as Condition;
  if (o.message) return o.message;
  if (o.source.kind === 'script') return `{{ticker}} ${o.label}`;
  const v = $<HTMLInputElement>('#alVal').value, v2 = $<HTMLInputElement>('#alVal2').value;
  const what = o.source.kind === 'price' ? '' : ` ${o.label}`;
  const val = o.source.kind === 'drawing' ? '' : isChannel(c) ? ` ${v} – ${v2}` : isMoving(c) ? ` ${v}${c.endsWith('pct') ? '%' : ''}` : ` ${v}`;
  return `{{ticker}}${what} ${COND_LABEL[c] ?? ''}${val}`.replace(/\s+/g, ' ').trim();
}
function readForm(): AlertForm {
  const v = (id: string) => $<HTMLInputElement>(id).value;
  return {
    name: v('#alName'), sym: v('#alSym'), tf: v('#alTf'), source: curOpt().source, condition: ($<HTMLSelectElement>('#alCond').value || undefined) as Condition | undefined,
    value: v('#alVal'), value2: v('#alVal2'), bars: v('#alBars'), frequency: v('#alFreq') as Frequency,
    expires: $<HTMLInputElement>('#alNever').checked ? '' : v('#alExp'), message: $<HTMLTextAreaElement>('#alMsg').value,
    channels: (['push', 'telegram', 'email', 'webhook'] as Channel[]).filter(c => $<HTMLInputElement>(`#alCh-${c}`).checked),
    webhookUrl: v('#alHookUrl'), webhookBody: $<HTMLTextAreaElement>('#alHookBody').value, active: editing ? editing.active || !!editing.stoppedReason : true,
  };
}
function wireDialog() {
  const dlg = $<HTMLDialogElement>('#alertDlg');
  $('#alSrc').onchange = () => { const o = curOpt(); if (!$<HTMLInputElement>('#alName').value && o.name) $<HTMLInputElement>('#alName').placeholder = o.name; onSource() };
  $('#alCond').onchange = onCondition;
  $('#alCancel').onclick = () => dlg.close();
  dlg.addEventListener('input', e => {
    const id = (e.target as HTMLElement).id;
    if (id === 'alMsg') msgTouched = true;
    if (id === 'alVal' || id === 'alVal2' || id.startsWith('alCh-') || id === 'alNever') onCondition();
  });
  $('#alChips').innerHTML = PLACEHOLDERS.map(p => `<button type="button" data-ph="${esc(p)}" title="Insert {{${esc(p)}}}">{{${esc(p)}}}</button>`).join('');
  $('#alChips').onclick = e => {
    const ph = (e.target as HTMLElement).dataset.ph; if (!ph) return;
    const t = $<HTMLTextAreaElement>('#alMsg'), s = t.selectionStart ?? t.value.length, ins = `{{${ph}}}`;
    t.value = t.value.slice(0, s) + ins + t.value.slice(t.selectionEnd ?? s); t.focus(); t.setSelectionRange(s + ins.length, s + ins.length); msgTouched = true;
  };
  $<HTMLFormElement>('#alertForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = readForm();
    if (!f.name.trim()) f.name = $<HTMLInputElement>('#alName').placeholder || '';
    const r = validateAlert(f);
    if ('error' in r) { $('#alErr').textContent = r.error; return }
    const btn = $<HTMLButtonElement>('#alSubmit'); btn.disabled = true;
    try {
      const saved = editing ? await api<Alert>(`/api/alerts/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: r.input }) : await api<Alert>('/api/alerts', { body: r.input });
      store.set('alertChannels', r.input.channels);
      dlg.close(); upsert(saved);
      toast(editing ? 'Alert saved' : `Alert created: ${r.input.name ?? r.input.sym}`);
    } catch (err) { $('#alErr').textContent = (err as Error).message }
    finally { btn.disabled = false }
  });
}
