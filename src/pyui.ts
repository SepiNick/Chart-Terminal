// "Python" tab of the bottom panel: the owner's own Python code, run on the active chart's bars by the server on this computer
// (server/pyrun.ts → ml/pyrun.py). Lines, markers and strategy trades come back as normal script outputs (src/python/result.ts).
// Scripts are stored with the Pine / MQL / NinjaScript scripts (lang 'python'). docs/python.md
import { createPineEditor, type PineEditor } from './pine/editor.ts';
import { allScripts, saveScripts, type PineHost, type Script } from './pineui.ts';
import { detectEntries, paramValues, parseParams, type PyEntry, type PyParam } from './python/params.ts';
import { normalize, summary } from './python/result.ts';
import { EXAMPLES, NEW_PY } from './python/examples.ts';
import { gate, isStandalone, onServersChanged } from './servers.ts';
import { apiTrade } from './sync.ts';
import { showMenu } from './menu.ts';
import { store, $, esc, toast } from './store.ts';

interface PyStatus { enabled: boolean; remote: boolean; local: boolean; canRun: boolean; python: string | null; packages: Record<string, boolean>; timeoutSec: number; maxBars: number }
interface PyAnswer {
  ok: boolean; result?: unknown; stdout?: string; stderr?: string; durationMs?: number; timedOut?: boolean; truncated?: { stdout: boolean; stderr: boolean };
  error?: { type: string; message: string; line: number | null; traceback: string };
}
const ENTRY_LABEL: Record<PyEntry, string> = { indicator: 'indicator(df, params)', strategy: 'strategy(df, params)', script: 'whole script (prints only)' };

let host: PineHost, editor: PineEditor | null = null, editingId = store.get<string>('pyEditing', ''), busy = false, defsKey = '', defs: PyParam[] = [];
const typed = store.get<Record<string, Record<string, unknown>>>('pyParams', {});   // last parameter values per script
const scripts = () => allScripts();
const isPy = (s: Script | undefined) => s?.lang === 'python';
const cur = () => { const s = scripts()[editingId]; return isPy(s) ? s : undefined };
const uniqueName = (base: string) => { const names = new Set(Object.values(scripts()).map(s => s.name.toLowerCase())); let n = base, k = 2; const stem = base.replace(/\.py$/i, ''); while (names.has(n.toLowerCase())) n = `${stem}${k++}.py`; return n };
const fileName = (n: string) => (/\.py$/i.test(n) ? n : n + '.py');

function create(name: string, src: string): Script {
  const s: Script = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: uniqueName(fileName(name)), src, updated: Date.now(), lang: 'python' };
  scripts()[s.id] = s; saveScripts();
  return s;
}
function open(id: string) {
  const s = scripts()[id]; if (!isPy(s)) return;
  editingId = id; store.set('pyEditing', id);
  editor?.setValue(s.src); editor?.setErrors([]);
  $('#pyName').textContent = s.name;
  refresh();
}
/** The script being edited, created from the editor text when there is none yet. */
function ensure(): Script {
  let s = cur();
  const src = editor!.getValue();
  if (!s) { s = create('script.py', src); editingId = s.id; store.set('pyEditing', s.id); $('#pyName').textContent = s.name }
  if (s.src !== src) { s.src = src; s.updated = Date.now(); saveScripts() }
  return s;
}

// ---------- entry selector and parameter inputs, derived from the code ----------
function refresh() {
  if (!editor) return;
  const src = editor.getValue(), entries = detectEntries(src), sel = $<HTMLSelectElement>('#pyEntry'), keep = sel.value as PyEntry;
  const want = entries.includes(keep) ? keep : entries[0];
  if (sel.options.length !== entries.length || [...sel.options].some((o, i) => o.value !== entries[i])) sel.innerHTML = entries.map(e => `<option value="${e}">${esc(ENTRY_LABEL[e])}</option>`).join('');
  sel.value = want;
  defs = parseParams(src);
  const key = JSON.stringify(defs) + editingId;
  if (key === defsKey) return;   // typing elsewhere in the code must not rebuild (and lose focus in) the inputs
  defsKey = key;
  const mine = typed[editingId] ?? {}, box = $('#pyParams');
  box.hidden = !defs.length;
  box.innerHTML = defs.length ? '<span class="muted">Inputs</span>' + defs.map(d => {
    const v = mine[d.name] ?? d.value, id = `pyp-${d.name}`;
    const field = d.kind === 'bool' ? `<input id="${esc(id)}" type="checkbox" data-p="${esc(d.name)}" ${v ? 'checked' : ''}>`
      : d.kind === 'string' ? `<input id="${esc(id)}" type="text" data-p="${esc(d.name)}" value="${esc(v)}">`
      : `<input id="${esc(id)}" type="number" step="${d.kind === 'int' ? 1 : 'any'}" data-p="${esc(d.name)}" value="${esc(v)}">`;
    return `<label for="${esc(id)}">${esc(d.name)} ${field}</label>`;
  }).join('') : '';
}
function readParams(): Record<string, string | number | boolean> {
  const raw: Record<string, unknown> = {};
  document.querySelectorAll<HTMLInputElement>('#pyParams [data-p]').forEach(i => { raw[i.dataset.p!] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? (i.value === '' ? NaN : +i.value) : i.value });
  typed[editingId] = raw; store.set('pyParams', typed);
  return paramValues(defs, raw);
}

// ---------- console ----------
const con = () => $('#pyConsole');
const line = (cls: string, text: string) => `<div class="${cls}">${esc(text)}</div>`;
function say(html: string) { con().innerHTML = html }

// ---------- run ----------
async function run() {
  if (busy || !editor) return;
  const g = gate('python');
  if (!g.on) return toast(g.why);
  const p = host.active(), all = p.vb();
  if (!all.length) return toast('The active chart has no bars yet');
  const s = ensure(), entry = ($<HTMLSelectElement>('#pyEntry').value || 'script') as PyEntry, params = readParams();
  const sent = all.slice(-20_000);
  busy = true; $<HTMLButtonElement>('#pyRun').disabled = true; $('#pyRun').textContent = '… Running';
  editor.setErrors([]);
  say(line('muted', `Running ${entry === 'script' ? 'the script' : entry + '()'} on ${sent.length} bars of ${p.cfg.symbol} ${p.cfg.tf}…`));
  try {
    const r = await apiTrade<PyAnswer>('/api/py/run', { body: { code: s.src, entry, name: s.name, symbol: p.cfg.symbol, tf: p.cfg.tf, params, bars: sent.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })) } });
    show(r, entry, sent.map(b => b.time), s);
  } catch (e) {
    const err = e as Error & { status?: number };
    say(line('err', err.status === 429 ? 'A run is already in progress. Wait for it to finish.' : err.message));
  } finally { busy = false; $<HTMLButtonElement>('#pyRun').disabled = false; $('#pyRun').textContent = '▶ Run on chart' }
}
function show(r: PyAnswer, entry: PyEntry, times: number[], s: Script) {
  const out: string[] = [];
  const dump = (text: string | undefined, cls: string, cut?: boolean) => { if (text) out.push(`<div class="${cls}" style="white-space:pre-wrap">${esc(text.replace(/\n$/, ''))}</div>`); if (cut) out.push(line('warn', 'Output was cut at 64 KB.')) };
  if (!r.ok) {
    const e = r.error!;
    dump(r.stdout, '', r.truncated?.stdout);
    dump(r.stderr, 'warn', r.truncated?.stderr);
    out.push(line('err', e.traceback && !r.timedOut ? e.traceback.trim() : `${e.type}: ${e.message}`));
    if (e.line) editor?.setErrors([{ line: e.line, col: 1, msg: `${e.type}: ${e.message}`, wide: true }]);
    return say(out.join(''));
  }
  dump(r.stdout, '', r.truncated?.stdout);
  dump(r.stderr, 'warn', r.truncated?.stderr);
  const ms = `${r.durationMs ?? 0} ms`;
  if (entry === 'script') { out.push(line('muted', `Finished in ${ms}.`)); return say(out.join('')) }
  const { data, warnings } = normalize(r.result, times);
  warnings.slice(0, 20).forEach(w => out.push(line('warn', w)));
  const name = s.name.replace(/\.py$/i, ''), id = 'py:' + s.id;
  host.active().setPyRun(id, { id, name, ms: r.durationMs ?? 0, data });
  out.push(line('muted', `Done in ${ms}: ${summary(data)} drawn on the chart.`));
  if (data.trades || data.signals) out.push('<div><a data-tester>Open the Strategy Tester</a></div>');
  say(out.join(''));
}

// ---------- files, scripts menu ----------
async function load(f: File) {
  if (f.size > 512 * 1024) return toast('That file is larger than 512 KB');
  const src = await f.text(), name = fileName(f.name), old = Object.values(scripts()).find(s => isPy(s) && s.name.toLowerCase() === name.toLowerCase());
  let s: Script;
  if (old) { old.src = src; old.updated = Date.now(); saveScripts(); s = old } else s = create(name, src);
  open(s.id); toast(`${old ? 'Updated' : 'Opened'} ${s.name}`);
}
function removeFromCharts(id: string) { host.panes().forEach(p => p.setPyRun('py:' + id, null)) }
function menu(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), mine = Object.values(scripts()).filter(isPy).sort((a, b) => b.updated - a.updated), s = cur();
  showMenu(r.left, r.bottom + 2, [
    { label: 'New Python script', icon: '＋', action: () => open(create('script.py', NEW_PY).id) },
    { label: 'Examples', sub: EXAMPLES.map(x => ({ label: x.name, action: () => open(create(x.file, x.src).id) })) },
    ...(mine.length ? [{ sep: true }, { label: 'My Python scripts', disabled: true }] : []),
    ...mine.map(m => ({ label: m.name, checked: m.id === editingId, action: () => open(m.id) })),
    ...(s ? [{ sep: true }, { label: `Rename “${s.name}”…`, icon: '✎', action: () => { const n = prompt('File name', s.name); if (n?.trim()) { s.name = uniqueName(fileName(n.trim())); saveScripts(); $('#pyName').textContent = s.name } } },
      { label: `Delete “${s.name}”`, icon: '🗑', action: () => {
        if (!confirm(`Delete “${s.name}”?`)) return;
        removeFromCharts(s.id); delete scripts()[s.id]; saveScripts();
        const next = Object.values(scripts()).find(isPy);
        if (next) open(next.id); else { editingId = ''; store.set('pyEditing', ''); editor?.setValue(NEW_PY); $('#pyName').textContent = 'Untitled'; refresh() }
      } }] : []),
  ]);
}

// ---------- availability: standalone / no suitable server / switched off ----------
async function availability() {
  const off = $('#pyOff'), body = $('#pyBody'), status = $('#pyStatus');
  const stop = (html: string) => { off.innerHTML = html; off.hidden = false; body.hidden = true };
  if (isStandalone()) return stop('Python needs a server on this computer. This app is running without a server (standalone mode); the Pine, MQL and NinjaScript editors work here, but Python code cannot run in a browser.');
  const g = gate('python');
  if (!g.on) return stop(`Python needs a server on this computer. ${esc(g.why)}`);
  let st: PyStatus;
  try { st = await apiTrade<PyStatus>('/api/py/status') } catch (e) { return stop(`Could not reach the Python tool: ${esc((e as Error).message)}`) }
  if (!st.enabled) return stop('Python is switched off. It runs your own code with the same rights as this program, so it starts off. To use it, open <a data-srv>Server settings</a> on the computer that runs the server and switch on “Run Python code”.');
  if (!st.canRun) return stop('Python is on, but only for the computer that runs the server. To use it from this device, switch on “Also allow other devices” in Server settings on that computer.');
  if (!st.python) return stop('Python 3 was not found on the server computer. Install it from python.org (tick “Add python.exe to PATH”), then <code>pip install pandas numpy</code>; or set CT_PYTHON to the interpreter.');
  off.hidden = true; body.hidden = false;
  const missing = ['pandas', 'numpy'].filter(k => !st.packages[k]);
  status.textContent = `Python ${st.python}${missing.length ? ` · missing: ${missing.join(', ')} (pip install ${missing.join(' ')})` : ''} · limit ${st.timeoutSec} s`;
  status.className = missing.length ? 'dn' : 'muted';
  mount();
}

function mount() {
  if (editor) return;
  const s = cur();
  editor = createPineEditor($('#pyEditor'), {
    doc: s?.src ?? NEW_PY, completions: ['df', 'params', 'PARAMS', 'indicator', 'strategy', 'plots', 'markers', 'hlines', 'trades', 'long_entry', 'long_exit', 'short_entry', 'short_exit', 'position'],
    keywords: 'def return import from as if elif else for while in not and or is None True False class try except finally with lambda pass break continue print len range'.split(' '), lang: 'python',
    onRun: () => { ensure(); toast('Saved') }, onChange: debounce(() => { editor?.setErrors([]); refresh(); const c = cur(); if (c && c.src !== editor!.getValue()) ensure() }, 600),
  });
  $('#pyName').textContent = s?.name ?? 'Untitled';
  refresh();
}
const debounce = (fn: () => void, ms: number) => { let t = 0; return () => { clearTimeout(t); t = window.setTimeout(fn, ms) } };

export function initPyUI(h: PineHost) {
  host = h;
  new MutationObserver(() => { if ($('#b-python').classList.contains('on')) availability() }).observe($('#b-python'), { attributes: true, attributeFilter: ['class'] });
  onServersChanged(() => { if ($('#b-python').classList.contains('on')) availability() });
  $('#pyRun').onclick = run;
  $('#pyScripts').onclick = menu;
  $('#pySave').onclick = () => { if (editor) { ensure(); toast('Saved') } };
  $('#pyClear').onclick = () => { const s = cur(); if (s) removeFromCharts(s.id); editor?.setErrors([]); say('') };
  $('#pyExport').onclick = () => {
    if (!editor) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([editor.getValue()], { type: 'text/x-python' }));
    a.download = cur()?.name ?? 'script.py'; a.click();
  };
  $<HTMLInputElement>('#pyImport').onchange = async e => { const i = e.target as HTMLInputElement, f = i.files?.[0]; if (f) await load(f); i.value = '' };
  const pane = $('#b-python');
  pane.ondragover = e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); $('#pyBody').classList.add('drop') } };
  pane.ondragleave = () => $('#pyBody').classList.remove('drop');
  pane.ondrop = async e => {
    e.preventDefault(); $('#pyBody').classList.remove('drop');
    const f = [...(e.dataTransfer?.files ?? [])].find(x => /\.(py|txt)$/i.test(x.name));
    if (!f) return toast('Drop a .py file');
    if (!editor) await availability();
    if (editor) await load(f);
  };
  $('#pyParams').oninput = () => readParams();
  $('#pyConsole').onclick = e => { if ((e.target as HTMLElement).dataset.tester !== undefined) host.showTab('tester') };
  $('#pyOff').onclick = e => { if ((e.target as HTMLElement).dataset.srv !== undefined) $('#srvBtn').click() };
}
