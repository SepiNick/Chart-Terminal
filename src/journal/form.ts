// Journal entry form: trade or no-trade day; tabs for essentials, reasons, checklist, media, tags, emotions, crypto and custom fields.
import { journal, commitJournal, journalHost } from '../journalui.ts';
import { EXIT_KINDS, FEELINGS, MISTAKES, uid, type JTrade } from '../journal.ts';
import { DISCIPLINE_ITEMS, award, pointsOf, rOf, rrExpected } from './analytics.ts';
import { delMedia, mediaUrl, putMedia, record, shrink } from './media.ts';
import { go, money, cls } from './workspace.ts';
import { $, esc, store, toast } from '../store.ts';

const TABS: [string, string][] = [['essentials', 'Essentials'], ['reasons', 'Entry & exit reasons'], ['checklist', 'Checklist'], ['media', 'Pictures & voice'], ['tags', 'Tags'], ['emotions', 'Emotions'], ['crypto', 'Crypto'], ['custom', 'Custom fields']];
let tab = store.get('jwFormTab', 'essentials');
let draft: JTrade | null = null, isNew = false, recorder: { stop: () => Promise<Blob> } | null = null;

const blank = (): JTrade => {
  const j = journal(), acc = j.account || (j.accounts ?? []).find(a => a.kind !== 'paper')?.id || 'paper', now = Math.floor(Date.now() / 1000);
  return { id: uid(), accountId: acc, kind: 'trade', createdAt: now, sym: '', dir: 'long', status: 'closed', openTime: now, closeTime: now, qty: 0, maxQty: 0, avgEntry: 0, exitQty: 0, gross: 0, fees: 0, net: 0, fills: [], mfe: 0, mae: 0, tf: '1h' };
};
const toLocal = (t?: number) => { if (!t) return ''; const d = new Date(t * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) };
const fromLocal = (s: string) => (s ? Date.parse(s) / 1000 : undefined);
const v = (x: unknown) => (x == null || (typeof x === 'number' && !Number.isFinite(x)) ? '' : esc(String(x)));
const chips = (name: string, all: string[], on: string[] = [], max = 99, editable = '') =>
  `<div class="chips" data-chips="${name}" data-max="${max}">${all.map(x => `<button type="button" class="${on.includes(x) ? 'on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}${editable ? `<button type="button" class="x" data-addlist="${editable}" title="Add an option">＋</button>` : ''}</div>`;
const scale = (name: string, val = 0, lo = 'Very low', hi = 'Very high') => `<div class="jw-scale"><span class="muted">${lo}</span>${chips(name, ['1', '2', '3', '4', '5'], val ? [String(val)] : [], 1)}<span class="muted">${hi}</span></div>`;
const field = (label: string, input: string, hint = '') => `<label class="jw-field"><span>${label}</span>${input}${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
const inp = (name: string, val: unknown, type = 'text', extra = '') => `<input name="${name}" type="${type}" value="${v(val)}" ${type === 'number' ? 'step="any"' : ''} ${extra}>`;

export function renderForm(main: HTMLElement, id: string) {
  const j = journal(), found = id ? j.trades.find(t => t.id === id) : undefined;
  if (id === '#notrade') { draft = { ...blank(), kind: 'notrade' }; isNew = true; tab = 'essentials' }
  else if (!draft || draft.id !== (found?.id ?? draft.id) || (id && !found) || (!id && !isNew)) { draft = found ? structuredClone(found) : blank(); isNew = !found }
  draw(main);
  main.onclick = e => onClick(e, main);
  main.oninput = e => { read(main); if ((e.target as HTMLElement).dataset.live) draw(main, true) };
  main.onchange = e => onChange(e, main);
  main.onpaste = e => { const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); addImage(f, main) } };
}

function draw(main: HTMLElement, keepScroll = false) {
  const t = draft!, j = journal(), nt = t.kind === 'notrade', captured = t.accountId === 'paper' && t.fills.length > 0;
  const tmp = structuredClone(t); award(tmp);
  const r = rOf(t), rexp = rrExpected(t), pts = pointsOf(tmp);
  const top = main.scrollTop;
  const tabs = TABS.filter(([k]) => !nt || ['essentials', 'checklist', 'media', 'tags', 'emotions'].includes(k));
  if (!tabs.some(([k]) => k === tab)) tab = 'essentials';
  main.innerHTML = `<div class="jw-form">
    <div class="jw-toolbar"><button data-act="back">← Journals</button><b>${isNew ? 'New entry' : esc(t.title || `${t.sym} ${t.dir}`)}</b>
      <span class="grow"></span><span class="jw-points" title="${DISCIPLINE_ITEMS.map(i => `${i.label}: ${tmp.points?.[i.key] ? '✓' : '—'}`).join('\n')}">Discipline points <b>${pts}</b>/80</span>
      ${isNew ? '' : '<button data-act="chart">Show on chart</button><button data-act="delete" class="dn">Delete</button>'}<button data-act="save" class="on">Save entry</button></div>
    <div class="seg jw-mode"><button data-mode="trade" class="${nt ? '' : 'on'}">Trade</button><button data-mode="notrade" class="${nt ? 'on' : ''}">No-trade day</button></div>
    <div class="jw-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="jw-panel">${({ essentials, reasons, checklist, media, tags, emotions, crypto, custom } as Record<string, (t: JTrade, captured: boolean) => string>)[tab](t, captured)}</div>
    ${!nt && t.status === 'closed' && (t.net || r != null) ? `<div class="jw-summary">Result <b class="${cls(t.net)}">${money(t.net)}</b>${r != null ? ` · <b>${r.toFixed(2)}R</b>` : ''}${rexp != null ? ` · planned ${rexp.toFixed(2)}R` : ''}${t.mfe || t.mae ? ` · MFE ${money(t.mfe)} / MAE ${money(t.mae)}` : ''}</div>` : ''}
  </div>`;
  void j;
  if (keepScroll) main.scrollTop = top;
  if (tab === 'media') loadMedia(main);
}

// ---------- tabs ----------
function essentials(t: JTrade, captured: boolean) {
  const j = journal();
  const accounts = `<select name="accountId">${(j.accounts ?? []).map(a => `<option value="${esc(a.id)}" ${a.id === t.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
  if (t.kind === 'notrade') return `<div class="jw-fields">
    ${field('Account', accounts)}${field('Symbol', inp('sym', t.sym, 'text', 'list="jwSyms" placeholder="e.g. BTCUSDT"'))}${field('Timeframe', inp('tf', t.tf))}${field('Date', inp('openTime', toLocal(t.openTime), 'datetime-local'))}
    <label class="jw-field wide"><span>Why didn't you trade?</span><textarea name="noTradeReason" rows="4" placeholder="No setup, outside my session, news risk, daily loss limit reached…">${v(t.noTradeReason)}</textarea></label>
    ${symList()}</div>`;
  const lock = captured ? 'disabled title="Captured from the paper account fills"' : '';
  const result = t.net >= 0 ? 'profit' : 'loss';
  return `<div class="jw-fields">
    ${field('Account', accounts)}${field('Title', inp('title', t.title, 'text', 'placeholder="Optional"'))}
    ${field('Symbol', inp('sym', t.sym, 'text', `list="jwSyms" placeholder="e.g. EURUSD, BTCUSDT" ${lock}`))}
    ${field('Direction', `<div class="seg"><button type="button" data-dir="long" class="${t.dir === 'long' ? 'on buyc' : ''}" ${lock}>Buy</button><button type="button" data-dir="short" class="${t.dir === 'short' ? 'on sellc' : ''}" ${lock}>Sell</button></div>`)}
    ${field('Timeframe', inp('tf', t.tf, 'text', 'list="jwTfs"'))}
    ${field('Entry date and time', inp('openTime', toLocal(t.openTime), 'datetime-local', lock))}
    ${field('Result', `<div class="seg"><button type="button" data-res="profit" class="${result === 'profit' ? 'on buyc' : ''}" ${lock}>Profit</button><button type="button" data-res="loss" class="${result === 'loss' ? 'on sellc' : ''}" ${lock}>Loss</button></div>`)}
    ${field('Amount ($)', inp('netAbs', Math.abs(t.net) || '', 'number', `min="0" ${lock}`), 'Net, after commission and swap')}
    ${field('Volume (lots or units)', inp('maxQty', t.maxQty || '', 'number', `min="0" ${lock}`))}
    ${field('Risk-free trade?', `<label class="jw-switch"><input type="checkbox" name="riskFree" ${t.riskFree ? 'checked' : ''}> Stop moved to break-even</label>`)}
    <h4 class="wide">Optional details</h4>
    ${field('Entry price', inp('avgEntry', t.avgEntry || '', 'number', `data-live="1" ${lock}`))}${field('Exit price', inp('avgExit', t.avgExit, 'number', `data-live="1" ${lock}`))}
    ${field('Initial stop loss', inp('stop', t.stop, 'number', 'data-live="1"'))}${field('Initial take profit', inp('target', t.target, 'number', 'data-live="1"'))}
    ${field('Final stop loss', inp('stopFinal', t.stopFinal, 'number'))}${field('Final take profit', inp('targetFinal', t.targetFinal, 'number'))}
    ${field('Actual R (manual)', inp('rrActual', t.rrActual, 'number', 'placeholder="auto from stop"'))}${field('Expected R (manual)', inp('rrExpected', t.rrExpected, 'number', 'placeholder="auto from stop & target"'))}
    ${field('Exit date and time', inp('closeTime', toLocal(t.closeTime), 'datetime-local', lock))}
    ${field('Commission', inp('fees', t.fees || '', 'number', lock))}${field('Swap', inp('swap', t.swap, 'number'))}${field('Risk % of account', inp('riskPct', t.riskPct, 'number', 'placeholder="auto"'))}
    ${field('Setup / playbook', `<input name="setup" list="jwSetups" value="${v(t.setup)}"><datalist id="jwSetups">${j.setups.map(s => `<option value="${esc(s)}">`).join('')}</datalist>`)}
    ${symList()}<datalist id="jwTfs">${['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'].map(x => `<option value="${x}">`).join('')}</datalist>
  </div>`;
}
const symList = () => `<datalist id="jwSyms">${[...new Set(journal().trades.map(t => t.sym))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>`;
function reasons(t: JTrade) {
  const j = journal();
  return `<div class="jw-fields">
    <div class="jw-field wide"><span>Entry reasons</span>${chips('entryReasons', j.entryReasons ?? [], t.entryReasons, 99, 'entryReasons')}</div>
    <label class="jw-field wide"><span>Entry reason notes</span><textarea name="entryReason" rows="2">${v(t.entryReason)}</textarea></label>
    <div class="jw-field wide"><span>Exit reasons</span>${chips('exitReasons', j.exitReasons ?? [], t.exitReasons, 99, 'exitReasons')}</div>
    <label class="jw-field wide"><span>Exit reason notes</span><textarea name="exitReason" rows="2">${v(t.exitReason)}</textarea></label>
    <div class="jw-field wide"><span>Exit type</span>${chips('exitKind', EXIT_KINDS, t.exitKind ? [t.exitKind] : [], 1)}</div>
    <label class="jw-field wide"><span>Trade notes</span><textarea name="notes" rows="3" placeholder="Feelings or anything special about this trade">${v(t.notes)}</textarea></label>
    <div class="jw-field wide"><span>Followed the plan?</span>${chips('followedPlan', ['Yes', 'No'], t.followedPlan == null ? [] : [t.followedPlan ? 'Yes' : 'No'], 1)}</div>
    <div class="jw-field wide"><span>Mistakes</span>${chips('mistakes', MISTAKES, t.mistakes)}</div>
    <label class="jw-field wide"><span>Lesson</span><textarea name="lesson" rows="2" placeholder="What would you do differently?">${v(t.lesson)}</textarea></label>
    <div class="jw-field wide"><span>Execution rating</span>${scale('rating', t.rating, 'Poor', 'Perfect')}</div>
  </div><p class="muted">Lists are yours: “＋” adds an option; manage them in Accounts &amp; settings.</p>`;
}
function checklist(t: JTrade) {
  const lists = journal().checklists ?? [];
  if (!lists.length) return `<p class="muted">No checklists yet.</p><button data-act="goChecklists">Create a checklist</button>`;
  const cur = lists.find(c => c.id === t.checklist?.id) ?? lists[0], done = t.checklist?.id === cur.id ? t.checklist.done : [];
  const total = cur.items.reduce((s, i) => s + (i.weight || 1), 0), got = cur.items.filter(i => done.includes(i.id)).reduce((s, i) => s + (i.weight || 1), 0);
  return `<div class="jw-fields"><label class="jw-field"><span>Checklist</span><select name="checklistId">${lists.map(c => `<option value="${esc(c.id)}" ${c.id === cur.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
    <div class="jw-field"><span>Score</span><b>${total ? Math.round((got / total) * 100) : 0}%</b></div></div>
    <div class="jw-check">${cur.items.map(i => `<label><input type="checkbox" data-check="${esc(i.id)}" ${done.includes(i.id) ? 'checked' : ''}> ${esc(i.text)}${cur.advanced ? ` <small class="muted">weight ${i.weight}</small>` : ''}</label>`).join('')}</div>`;
}
function media(t: JTrade) {
  return `<div class="jw-toolbar"><label class="btn">🖼 Add pictures<input type="file" id="jwPics" accept="image/*" multiple hidden></label>
    <button data-act="snap">📷 Chart snapshot</button><button data-act="rec" class="${recorder ? 'dn' : ''}">${recorder ? '■ Stop recording' : '🎙 Record voice note'}</button>
    <span class="muted">or paste a picture with Ctrl+V</span></div>
    <div class="jw-media">${t.shot?.startsWith('data:image/') ? `<figure><img src="${esc(t.shot)}" alt="Chart snapshot"><button class="x" data-act="dropShot" title="Remove">✕</button></figure>` : ''}
    ${(t.media ?? []).map(m => `<figure data-mid="${esc(m.id)}" data-kind="${m.kind}"><span class="muted">loading…</span><button class="x" data-delmedia="${esc(m.id)}" title="Remove">✕</button></figure>`).join('')}</div>
    ${!t.shot && !t.media?.length ? '<p class="muted">No pictures or voice notes yet.</p>' : ''}`;
}
async function loadMedia(main: HTMLElement) {
  for (const f of main.querySelectorAll<HTMLElement>('figure[data-mid]')) {
    const u = await mediaUrl(f.dataset.mid!), ph = f.querySelector('span');
    if (!u) { if (ph) ph.textContent = 'missing'; continue }
    const el = f.dataset.kind === 'audio' ? Object.assign(document.createElement('audio'), { controls: true, src: u }) : Object.assign(document.createElement('img'), { src: u, alt: 'Journal picture' });
    ph?.replaceWith(el);
  }
}
function tags(t: JTrade) {
  const j = journal(), all = [...new Set([...(j.tagList ?? []), ...j.trades.flatMap(x => x.tags ?? [])])];
  return `<div class="jw-field wide"><span>Tags</span>${chips('tags', all, t.tags, 99, 'tagList')}</div><p class="muted">Tags work as filters in Journals and break-downs in Analyses.</p>`;
}
function emotions(t: JTrade) {
  const j = journal();
  return `<div class="jw-fields">
    <div class="jw-field wide"><span>Before the trade <small class="muted">(up to 4)</small></span>${chips('emotionsBefore', FEELINGS, t.emotionsBefore, 4)}</div>
    <div class="jw-field wide"><span>After the trade <small class="muted">(up to 4)</small></span>${chips('emotionsAfter', FEELINGS, t.emotionsAfter, 4)}</div>
    <div class="jw-field wide"><span>Energy and physical readiness</span>${scale('energy', t.energy, 'Very low', 'Excellent')}</div>
    <div class="jw-field wide"><span>Confidence in the setup</span>${scale('confidence', t.confidence)}</div>
    <div class="jw-field wide"><span>Why did you enter?</span>${chips('motives', j.motives ?? [], t.motives, 99, 'motives')}</div>
    ${(j.questions ?? []).map((q, i) => `<div class="jw-field wide"><span>${esc(q)}</span>${chips(`q${i}`, ['Yes', 'No'], t.answers?.[q] == null ? [] : [t.answers[q] ? 'Yes' : 'No'], 1)}</div>`).join('')}
    <button type="button" data-act="addq">＋ Add a custom yes/no question</button>
  </div>`;
}
function crypto(t: JTrade) {
  const c = t.crypto ?? {};
  return `<div class="jw-fields">
    ${field('Position value (not margin)', inp('c.notional', c.notional, 'number'))}
    ${field('Market', `<select name="c.market"><option value="">—</option><option value="futures" ${c.market === 'futures' ? 'selected' : ''}>Futures</option><option value="spot" ${c.market === 'spot' ? 'selected' : ''}>Spot</option></select>`)}
    ${field('Exchange', inp('c.exchange', c.exchange, 'text', 'list="jwExchanges"'))}<datalist id="jwExchanges">${['Binance', 'Bybit', 'OKX', 'Bitget', 'KuCoin', 'MEXC', 'Gate', 'Nobitex', 'Wallex', 'Toobit'].map(x => `<option value="${x}">`).join('')}</datalist>
    ${field('Contract', `<select name="c.contract"><option value="">—</option>${['Spot', 'Perpetual', 'Quarterly', 'Bi-quarterly'].map(x => `<option ${c.contract === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
    ${field('Leverage', inp('c.leverage', c.leverage, 'number', 'min="1" max="200"'))}
    ${field('Margin mode', `<select name="c.margin"><option value="">—</option><option value="cross" ${c.margin === 'cross' ? 'selected' : ''}>Cross</option><option value="isolated" ${c.margin === 'isolated' ? 'selected' : ''}>Isolated</option></select>`)}
    ${field('Liquidation price', inp('c.liq', c.liq, 'number'))}${field('Funding fee', inp('c.funding', c.funding, 'number'))}${field('Network fee', inp('c.networkFee', c.networkFee, 'number'))}
  </div>`;
}
function custom(t: JTrade) {
  const fs = journal().fields ?? [];
  return `<div class="jw-fields">${fs.map(f => {
    const val = t.custom?.[f.id], name = esc(`f.${f.id}`);   // ids come from a backup or the server too
    const input = f.type === 'checkbox' ? `<label class="jw-switch"><input type="checkbox" name="${name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`
      : f.type === 'select' ? `<select name="${name}"><option value="">—</option>${(f.options ?? []).map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : inp(name, val, f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text');
    return field(esc(f.label), input);
  }).join('') || '<p class="muted">No custom fields yet.</p>'}</div>
  <div class="jw-toolbar"><input id="jwFieldLabel" placeholder="New field name"><select id="jwFieldType"><option value="text">Text</option><option value="number">Number</option><option value="select">Choice</option><option value="checkbox">Yes / no</option><option value="date">Date</option></select>
  <input id="jwFieldOpts" placeholder="Choices, comma separated"><button data-act="addField">Add field</button></div>
  <p class="muted">Custom fields appear on every entry. Removing one (Accounts &amp; settings) keeps the values already saved.</p>`;
}

// ---------- read / events ----------
function read(main: HTMLElement) {
  const t = draft!;
  for (const el of main.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name]')) {
    if ((el as HTMLInputElement).disabled) continue;
    const n = el.name, raw = el.value, isNum = (el as HTMLInputElement).type === 'number';
    const val = (el as HTMLInputElement).type === 'checkbox' ? (el as HTMLInputElement).checked : isNum ? (raw === '' ? undefined : +raw) : raw;
    if (n.startsWith('c.')) { t.crypto = { ...t.crypto, [n.slice(2)]: val === '' ? undefined : val }; continue }
    if (n.startsWith('f.')) { t.custom = { ...t.custom, [n.slice(2)]: val as string }; continue }
    if (n === 'openTime' || n === 'closeTime') { (t as unknown as Record<string, unknown>)[n] = fromLocal(raw as string); continue }
    if (n === 'netAbs') { const a = (val as number) ?? 0; t.net = t.net < 0 || (t as { _loss?: boolean })._loss ? -a : a; t.gross = t.net + (t.fees ?? 0); continue }
    if (n === 'checklistId') { if (t.checklist?.id !== raw) t.checklist = { id: raw as string, done: [] }; continue }
    if (n === 'sym') { t.sym = (raw as string).trim().toUpperCase(); continue }
    (t as unknown as Record<string, unknown>)[n] = val === '' ? undefined : val;
  }
}
function onChange(e: Event, main: HTMLElement) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.check) { const t = draft!, lists = journal().checklists ?? [], id = t.checklist?.id ?? lists[0]?.id; const done = new Set(t.checklist?.id === id ? t.checklist.done : []); if (el.checked) done.add(el.dataset.check); else done.delete(el.dataset.check); t.checklist = { id, done: [...done] }; draw(main, true); return }
  if (el.id === 'jwPics') { [...(el.files ?? [])].forEach(f => addImage(f, main)); el.value = ''; return }
  read(main);
  if (el.name === 'checklistId') draw(main, true);
}
async function addImage(f: Blob, main: HTMLElement) {
  try { const id = await putMedia(await shrink(f)); (draft!.media ??= []).push({ id, kind: 'image' }); draw(main, true) } catch (err) { toast(`Could not store the picture: ${(err as Error).message}`) }
}
async function onClick(e: MouseEvent, main: HTMLElement) {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
  const t = draft!, j = journal();
  if (b.dataset.tab) { read(main); tab = b.dataset.tab; store.set('jwFormTab', tab); draw(main); return }
  if (b.dataset.mode) { read(main); t.kind = b.dataset.mode as JTrade['kind']; draw(main); return }
  if (b.dataset.dir) { t.dir = b.dataset.dir as JTrade['dir']; draw(main, true); return }
  if (b.dataset.res) { read(main); t.net = (b.dataset.res === 'loss' ? -1 : 1) * Math.abs(t.net); (t as { _loss?: boolean })._loss = b.dataset.res === 'loss'; t.gross = t.net + (t.fees ?? 0); draw(main, true); return }
  const box = b.closest<HTMLElement>('[data-chips]');
  if (box && b.dataset.v != null) {
    const name = box.dataset.chips!, max = +box.dataset.max!, on = b.classList.contains('on');
    if (!on && max > 1 && box.querySelectorAll('button.on').length >= max) return toast(`Up to ${max}`);
    if (max === 1) box.querySelectorAll('button.on').forEach(x => x !== b && x.classList.remove('on'));
    b.classList.toggle('on');
    const vals = [...box.querySelectorAll<HTMLElement>('button.on')].map(x => x.dataset.v!);
    const rec = t as unknown as Record<string, unknown>;
    if (name === 'followedPlan') t.followedPlan = vals[0] == null ? undefined : vals[0] === 'Yes';
    else if (/^q\d+$/.test(name)) { const q = (j.questions ?? [])[+name.slice(1)]; t.answers = { ...t.answers }; if (vals[0] == null) delete t.answers[q]; else t.answers[q] = vals[0] === 'Yes' }
    else if (['exitKind'].includes(name)) rec[name] = vals[0];
    else if (['rating', 'energy', 'confidence'].includes(name)) rec[name] = vals[0] ? +vals[0] : undefined;
    else rec[name] = vals;
    draw(main, true); return;
  }
  if (b.dataset.addlist) {
    const key = b.dataset.addlist as 'entryReasons' | 'exitReasons' | 'motives' | 'tagList', val = prompt('New option')?.trim();
    if (val && !(j[key] ?? []).includes(val)) { (j[key] ??= []).push(val); commitJournal() }
    read(main); draw(main, true); return;
  }
  if (b.dataset.delmedia) { const id = b.dataset.delmedia; t.media = (t.media ?? []).filter(m => m.id !== id); draw(main, true); return }
  switch (b.dataset.act) {
    case 'back': draft = null; go('journals'); return;
    case 'goChecklists': go('checklists'); return;
    case 'dropShot': t.shot = undefined; draw(main, true); return;
    case 'snap': { const c = journalHost().shot(); if (!c) return toast('No chart to capture'); const id = await putMedia(await shrink(c)); (t.media ??= []).push({ id, kind: 'image', name: 'Chart' }); draw(main, true); return }
    case 'rec':
      if (recorder) { const blob = await recorder.stop(); recorder = null; const id = await putMedia(blob); (t.media ??= []).push({ id, kind: 'audio' }); draw(main, true) }
      else { try { recorder = await record(); draw(main, true) } catch { toast('Microphone not available or permission denied') } }
      return;
    case 'addq': { const q = prompt('Yes/no question to answer on every trade (e.g. “Did I wait for the candle close?”)')?.trim(); if (q) { (j.questions ??= []).push(q); commitJournal(); draw(main, true) } return }
    case 'addField': {
      const label = $<HTMLInputElement>('#jwFieldLabel').value.trim(), type = $<HTMLSelectElement>('#jwFieldType').value as 'text';
      if (!label) return toast('Give the field a name');
      (j.fields ??= []).push({ id: uid(), label, type, options: type === ('select' as string) ? $<HTMLInputElement>('#jwFieldOpts').value.split(',').map(s => s.trim()).filter(Boolean) : undefined });
      commitJournal(); read(main); draw(main, true); return;
    }
    case 'chart': read(main); journalHost().show(t.sym, t.openTime); $('#jw').hidden = true; return;
    case 'delete':
      if (!confirm('Delete this journal entry?')) return;
      for (const m of t.media ?? []) delMedia(m.id);
      j.trades = j.trades.filter(x => x.id !== t.id); draft = null; commitJournal(); go('journals'); return;
    case 'save': {
      read(main);
      if (!t.sym) { tab = 'essentials'; draw(main); return toast('Symbol is required') }
      if (t.kind === 'trade' && t.accountId !== 'paper' && t.fills.length === 0) {
        t.status = 'closed'; t.closeTime ??= t.openTime; t.exitQty = t.maxQty;
        t.gross = t.net + (t.fees ?? 0) - (t.swap ?? 0); t.mfe = Math.max(t.mfe, t.net, 0); t.mae = Math.min(t.mae, t.net, 0);
      }
      delete (t as { _loss?: boolean })._loss;
      // removed media blobs are deleted only when the entry is saved
      const old = j.trades.find(x => x.id === t.id);
      for (const m of old?.media ?? []) if (!t.media?.some(x => x.id === m.id)) delMedia(m.id);
      if (t.setup && !j.setups.includes(t.setup)) j.setups.push(t.setup);
      if (old) Object.assign(old, t); else j.trades.push(t);
      commitJournal(old ?? t);
      toast('Saved'); draft = null; isNew = false; go('journals'); return;
    }
  }
}
