// Script editor panel (Pine + MQL4/MQL5 + NinjaScript), script library/installation, inputs dialog and console.
import { usedFiles } from './scriptsig.ts';
import type { ChartPane, PaneCfg } from './chart.ts';
import { createPineEditor, type PineEditor } from './pine/editor.ts';
import { compile, isError, setInstalledScripts } from './pine/engine.ts';
import { BUILTIN_SCRIPTS, NEW_INDICATOR, NEW_STRATEGY } from './pine/builtins.ts';
import { fromBroker } from './pine/report.ts';
import { checkRepaint, repaintSummary } from './pine/repaint.ts';
import { tfSeconds } from './data.ts';
import { renderTester } from './testerui.ts';
import { initNoCode, openNoCode } from './nocodeui.ts';
import { LIB_NAMES } from './pine/lib/index.ts';
import type { PineValue } from './pine/types.ts';
import type { CompileResult } from './mql/contract.ts';
import { compileMql } from './mql/engine.ts';
import { NEW_MQL4_EA, NEW_MQL5_EA, NEW_MQL5_INDICATOR } from './mql/templates.ts';
import { NEW_NT_STRATEGY, NEW_NT_INDICATOR } from './ninja/templates.ts';
import { compileNinja } from './ninja/engine.ts';
import type { NtCompileResult } from './ninja/contract.ts';
import { showMenu } from './menu.ts';
import { store, $, esc, toast } from './store.ts';
import type { ScriptSource } from './alerttypes.ts';

export type Lang = 'pine' | 'mql4' | 'mql5' | 'mqh' | 'ninja';
export interface Script { id: string; name: string; src: string; updated: number; lang?: Lang }
export interface PineHost {
  active(): ChartPane;
  panes(): ChartPane[];
  applyCfg(p: ChartPane, patch: Partial<PaneCfg>, label: string): void;
  showTab(tab: string): void;
}

const scripts = store.get<Record<string, Script>>('scripts', {});
let editingId = store.get<string>('pineEditing', '');
let editor: PineEditor | null = null;
let host: PineHost;
const save = () => store.set('scripts', scripts);
setInstalledScripts(() => Object.values(scripts).filter(s => langOf(s) === 'pine').map(s => s.src));   // Pine `import` resolves libraries here
const langOf = (s: Script | undefined): Lang => s?.lang ?? 'pine';
const isMql = (l: Lang) => l === 'mql4' || l === 'mql5' || l === 'mqh';
const isCode = (l: Lang) => l !== 'pine';   // file-named (MQL or C#) rather than titled by indicator()
const langFromName = (name: string): Lang => /\.mq4$/i.test(name) ? 'mql4' : /\.mq5$/i.test(name) ? 'mql5' : /\.mqh$/i.test(name) ? 'mqh' : /\.cs$/i.test(name) ? 'ninja' : 'pine';
const titleOf = (src: string) => src.match(/^\s*(?:indicator|strategy|library|study)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/m)?.[1] ?? 'Untitled';
const EXTRA_COMPLETIONS = ['indicator', 'strategy', 'library', 'plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'hline', 'fill', 'bgcolor', 'barcolor',
  'alertcondition', 'alert', 'input', 'input.int', 'input.float', 'input.bool', 'input.string', 'input.color', 'input.source', 'input.timeframe', 'input.symbol', 'input.session', 'input.price', 'input.text_area',
  'strategy.entry', 'strategy.exit', 'strategy.close', 'strategy.close_all', 'strategy.order', 'strategy.cancel', 'strategy.cancel_all', 'strategy.long', 'strategy.short',
  'strategy.position_size', 'strategy.position_avg_price', 'strategy.equity', 'strategy.netprofit', 'strategy.openprofit', 'strategy.percent_of_equity', 'strategy.cash', 'strategy.fixed',
  'label.new', 'label.delete', 'label.set_text', 'label.set_xy', 'line.new', 'line.delete', 'line.set_xy1', 'line.set_xy2', 'box.new', 'box.delete', 'na', 'nz', 'fixnan', 'timestamp',
  'open', 'high', 'low', 'close', 'volume', 'time', 'bar_index', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'last_bar_index', 'barstate.islast', 'barstate.isfirst', 'barstate.isconfirmed',
  'syminfo.ticker', 'syminfo.tickerid', 'syminfo.mintick', 'timeframe.period', 'plot.style_line', 'plot.style_histogram', 'plot.style_columns', 'plot.style_circles', 'plot.style_area', 'plot.style_stepline',
  'shape.triangleup', 'shape.triangledown', 'shape.circle', 'shape.labelup', 'shape.labeldown', 'shape.arrowup', 'shape.arrowdown', 'location.abovebar', 'location.belowbar', 'location.top', 'location.bottom',
  'size.tiny', 'size.small', 'size.normal', 'size.large', 'hline.style_dashed', 'hline.style_dotted', 'hline.style_solid', 'log.info', 'log.warning', 'log.error', 'request.security', 'request.security_lower_tf'];

function newScript(src: string, name?: string, lang?: Lang): Script {
  const l = lang ?? (name ? langFromName(name) : 'pine');
  const s: Script = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name ?? titleOf(src), src, updated: Date.now(), lang: l };
  scripts[s.id] = s; save();
  return s;
}

// ---------- MQL compilation ----------
const compileCache = new Map<string, CompileResult>();
/** All installed MQL sources keyed by file name (what #include resolves against). */
function mqlFiles(override?: { id: string; src: string }): Record<string, string> {
  const files: Record<string, string> = {};
  for (const s of Object.values(scripts)) if (isMql(langOf(s))) files[s.name] = override?.id === s.id ? override.src : s.src;
  return files;
}
function compileMqlScript(id: string, override?: string): CompileResult {
  const s = scripts[id];
  const files = mqlFiles(override != null ? { id, src: override } : undefined);
  const key = s.name + '\u0000' + JSON.stringify(files);
  let r = compileCache.get(key);
  if (!r) {
    r = compileMql(s.name, files);
    if (compileCache.size > 30) compileCache.delete(compileCache.keys().next().value!);
    compileCache.set(key, r);
  }
  return r;
}

function open(id: string) {
  const s = scripts[id]; if (!s) return;
  editingId = id; store.set('pineEditing', id);
  editor?.setLanguage(langOf(s) === 'ninja' ? 'csharp' : isMql(langOf(s)) ? 'mql' : 'pine');
  editor?.setValue(s.src);
  $('#pnName').textContent = s.name;
  $('#pnAdd').textContent = langOf(s) === 'mqh' ? 'Include file' : 'Add to chart';
  check();
}
let checkSeq = 0;
/** Compile the editor contents and show errors inline. Resolves to true when there are no errors. */
async function check(): Promise<boolean> {
  if (!editor) return false;
  const s = scripts[editingId], lang = langOf(s), src = editor.getValue(), seq = ++checkSeq;
  if (lang === 'ninja' && s) {
    const r = compileNinjaScripts({ id: s.id, src });
    if (seq !== checkSeq) return r.ok;
    editor.setErrors(r.errors.filter(e => e.file === s.name || !e.file).map(e => ({ line: e.line, col: e.col, msg: e.msg })));
    $('#pnConsole').innerHTML = [...r.errors.map(e => `<div class="err">${esc(e.file)}(${e.line},${e.col}): error: ${esc(e.msg)}</div>`), ...r.warnings.slice(0, 30).map(w => `<div class="warn">${esc(w.file)}(${w.line},${w.col}): warning: ${esc(w.msg)}</div>`)].join('');
    const cls = mainClassOf(src);
    status(r.ok ? `NinjaScript · compiled: 0 errors${cls ? ` · runs ${cls}` : ' · no Indicator/Strategy class in this file'}` : `${r.errors.length} error(s)`, r.ok ? '' : 'err');
    return r.ok && !!cls;
  }
  if (!isMql(lang)) {
    const r = compile(src);
    if (isError(r)) { editor.setErrors([{ line: r.line, col: r.col, msg: r.msg }]); status(`Syntax error at ${r.line}:${r.col}: ${r.msg}`, 'err'); return false }
    editor.setErrors([]); status('No errors', ''); return true;
  }
  if (lang === 'mqh' || !s) { editor.setErrors([]); status('Include file — compiled as part of the programs that include it', ''); return true }
  status('Compiling…', '');
  const r = compileMqlScript(s.id, src);
  if (seq !== checkSeq) return r.ok;
  const mine = r.errors.filter(e => e.file === s.name || !e.file);
  editor.setErrors(mine.map(e => ({ line: e.line, col: e.col, msg: e.msg })));
  const con = $('#pnConsole');
  con.innerHTML = [...r.errors.map(e => `<div class="err">${esc(e.file)}(${e.line},${e.col}): error: ${esc(e.msg)}</div>`), ...r.warnings.slice(0, 30).map(w => `<div class="warn">${esc(w.file)}(${w.line},${w.col}): warning: ${esc(w.msg)}</div>`)].join('');
  status(r.ok ? `${r.dialect.toUpperCase()} · compiled: 0 errors, ${r.warnings.length} warnings` : `${r.errors.length} error(s)`, r.ok ? '' : 'err');
  return r.ok;
}
function status(msg: string, cls: string) { const el = $('#pnStatus'); el.textContent = msg; el.className = cls === 'err' ? 'dn' : 'muted' }

function saveCurrent(): Script | null {
  if (!editor) return null;
  const src = editor.getValue();
  let s = scripts[editingId];
  if (!s) s = newScript(src);
  s.src = src; if (!isCode(langOf(s))) s.name = titleOf(src); s.updated = Date.now(); save();
  editingId = s.id; store.set('pineEditing', s.id);
  $('#pnName').textContent = s.name;
  host.panes().forEach(p => { if (p.cfg.scripts?.length && (p.cfg.scripts.some(r => r.id === s!.id) || langOf(s!) === 'mqh')) p.build() });
  return s;
}

export const scriptById = (id: string) => scripts[id];
/** Save `src` as a new Pine script and show it in the Pine Editor (used by the AI panel). */
export function openNewScript(src: string) { const s = newScript(src); host.showTab('pine'); open(s.id); return s.id }
/** A chart script as sources for the server (forward tests, MQL / NinjaScript alerts): the script plus every installed file of its language (#include / other classes). */
export function sourceFor(id: string, prec: number): ScriptSource | null {
  const s = scripts[id]; if (!s) return null;
  const lang = langOf(s), fam = (l: Lang) => (isMql(l) ? 'mql' : l);
  if (lang === 'mqh') return null;
  if (lang === 'pine') return { lang, files: { 'main.pine': s.src }, main: 'main.pine', prec };
  return { lang, files: Object.fromEntries(usedFiles(s, Object.values(scripts).filter(x => fam(langOf(x)) === fam(lang)), lang === 'ninja').map(x => [x.name, x.src])), main: s.name, prec };
}
export const compileById = (id: string) => compileMqlScript(id);

// ---------- NinjaScript (C#) compilation: every installed .cs file is compiled together ----------
const ntCache = new Map<string, NtCompileResult>();
/** First Indicator/Strategy class declared in a .cs source — the one a chart runs. */
const mainClassOf = (src: string) => src.match(/class\s+(\w+)\s*:\s*(?:[\w.]*\.)?(Indicator|Strategy)\b/)?.[1];
export function compileNinjaScripts(override?: { id: string; src: string }): NtCompileResult {
  const files: Record<string, string> = {};
  for (const s of Object.values(scripts)) if (langOf(s) === 'ninja') files[s.name] = override?.id === s.id ? override.src : s.src;
  const key = JSON.stringify(files);
  let r = ntCache.get(key);
  if (!r) { r = compileNinja(files); if (ntCache.size > 20) ntCache.delete(ntCache.keys().next().value!); ntCache.set(key, r) }
  return r;
}

export function initPineUI(h: PineHost) {
  host = h;
  const mount = () => {
    if (editor) return;
    const s = scripts[editingId];
    editor = createPineEditor($('#pnEditor'), {
      doc: s?.src ?? NEW_INDICATOR, completions: [...new Set([...LIB_NAMES, ...EXTRA_COMPLETIONS])],
      onRun: async () => { if (await check()) { saveCurrent(); toast('Saved') } },
      onChange: debounce(() => { check() }, 500),
    });
    if (s) open(s.id); else check();
  };
  new MutationObserver(() => { if ($('#b-pine').classList.contains('on')) mount() }).observe($('#b-pine'), { attributes: true, attributeFilter: ['class'] });

  // No-code builder: rebuilding a strategy with the same name updates that script instead of adding another.
  initNoCode(src => {
    const name = titleOf(src), old = Object.values(scripts).find(x => langOf(x) === 'pine' && x.name === name);
    const s = old ?? newScript(src);
    if (old) { old.src = src; old.updated = Date.now(); save() }
    open(s.id);
    const p = host.active(), refs = p.cfg.scripts ?? [];
    // Inputs are reset: a rebuilt strategy may have different inputs at the same positions.
    host.applyCfg(p, { scripts: refs.some(r => r.id === s.id) ? refs.map(r => r.id === s.id ? { ...r, inputs: {} } : r) : [...refs, { id: s.id, inputs: {} }] }, 'no-code strategy');
    host.showTab('tester'); toast(old ? `Updated “${name}”` : `Created “${name}”`);
  });
  $('#tsNoCode').onclick = openNoCode;
  $('#pnSave').onclick = async () => { await check(); saveCurrent(); toast('Saved') };
  $('#pnAdd').onclick = async () => {
    const lang = langOf(scripts[editingId]);
    if (lang === 'mqh') { saveCurrent(); return toast('Include file saved — programs that #include it are rebuilt') }
    if (!(await check())) return toast('Fix the errors first');
    const s = saveCurrent()!, p = host.active();
    const refs = p.cfg.scripts ?? [];
    if (refs.some(r => r.id === s.id)) { p.build(); toast('Updated on chart') }
    else host.applyCfg(p, { scripts: [...refs, { id: s.id, inputs: {} }] }, 'add script');
    if (isCode(lang)) host.showTab('tester');
  };
  // Repaint check: does the script show values that used data from after the bar? (src/pine/repaint.ts)
  $('#pnRepaint').onclick = () => {
    const lang = langOf(scripts[editingId]), con = $('#pnConsole'), p = host.active();
    if (!editor || lang !== 'pine') return toast('The repaint check is for Pine scripts');
    const bars = p.vb();
    if (bars.length < 60) return toast('Load at least 60 bars on the active chart first');
    con.innerHTML = '<div class="muted">Checking for repainting…</div>';
    setTimeout(() => {   // let the message paint: the check runs the script a dozen times
      const r = checkRepaint(editor!.getValue(), bars, { symbol: p.cfg.symbol.replace(/^[A-Z0-9]+:/, ''), tf: p.cfg.tf, tfSec: tfSeconds(p.cfg.tf), mintick: 10 ** -p.prec });
      con.innerHTML = `<div class="${r.verdict === 'stable' ? 'muted' : 'err'}">${esc(repaintSummary(r))}</div>` + r.mismatches.slice(0, 12).map(m => `<div class="warn">bar ${new Date(m.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} · ${esc(m.what)}: ${esc(m.cut)} → ${esc(m.full)}</div>`).join('');
    }, 20);
  };
  $('#pnExport').onclick = () => {
    if (!editor) return;
    const s = scripts[editingId], a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([editor.getValue()], { type: 'text/plain' }));
    a.download = s && isCode(langOf(s)) ? s.name : `${titleOf(editor.getValue()).replace(/[^\w.-]+/g, '_')}.pine`;
    a.click();
  };
  $<HTMLInputElement>('#pnImport').onchange = async e => {
    const input = e.target as HTMLInputElement, list = [...(input.files ?? [])];
    let last: Script | null = null;
    for (const f of list) {
      const src = await f.text(), lang = langFromName(f.name);
      const existing = isCode(lang) ? Object.values(scripts).find(s => s.name.toLowerCase() === f.name.toLowerCase()) : undefined;
      if (existing) { existing.src = src; existing.updated = Date.now(); save(); last = existing }   // reinstall = update
      else last = newScript(src, isCode(lang) ? f.name : undefined, lang);
      if (lang === 'pine') { const r = compile(src); if (isError(r)) toast(`${last.name}: syntax error at line ${r.line}: ${r.msg}`, 6000) }
    }
    compileCache.clear(); ntCache.clear();
    if (last) { open(last.id); toast(`Installed ${list.length} file(s)`) }
    input.value = '';
  };
  $('#pnScripts').onclick = e => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mine = Object.values(scripts).sort((a, b) => b.updated - a.updated);
    const named = (src: string, ext: string, base: string) => { let n = `${base}.${ext}`, k = 2; while (Object.values(scripts).some(s => s.name === n)) n = `${base}${k++}.${ext}`; const s = newScript(src, n); open(s.id) };
    showMenu(r.left, r.bottom + 2, [
      { label: 'New Pine indicator', icon: '＋', action: () => open(newScript(NEW_INDICATOR).id) },
      { label: 'New Pine strategy', icon: '＋', action: () => open(newScript(NEW_STRATEGY).id) },
      { label: 'New strategy without code…', icon: '＋', action: openNoCode },
      { label: 'New MQL5 Expert Advisor', icon: '＋', action: () => named(NEW_MQL5_EA, 'mq5', 'MyExpert') },
      { label: 'New MQL5 indicator', icon: '＋', action: () => named(NEW_MQL5_INDICATOR, 'mq5', 'MyIndicator') },
      { label: 'New MQL4 Expert Advisor', icon: '＋', action: () => named(NEW_MQL4_EA, 'mq4', 'MyExpert4') },
      { label: 'New NinjaScript strategy', icon: '＋', action: () => named(NEW_NT_STRATEGY, 'cs', 'MyMaCross') },
      { label: 'New NinjaScript indicator', icon: '＋', action: () => named(NEW_NT_INDICATOR, 'cs', 'MyBands') },
      { label: 'Built-in Pine library', sub: BUILTIN_SCRIPTS.map(b => ({ label: b.name, hint: b.kind, action: () => open(newScript(b.src).id) })) },
      ...(mine.length ? [{ sep: true }, { label: 'My scripts', disabled: true }] : []),
      ...mine.map(s => ({ label: s.name, hint: langOf(s) === 'pine' ? 'Pine' : langOf(s) === 'ninja' ? 'NinjaScript' : langOf(s).toUpperCase(), checked: s.id === editingId, action: () => open(s.id) })),
      ...(scripts[editingId] ? [{ sep: true }, { label: `Delete “${scripts[editingId].name}”`, icon: '🗑', action: () => {
        if (!confirm(`Delete “${scripts[editingId].name}”? Charts using it will drop it.`)) return;
        const id = editingId; delete scripts[id]; save(); compileCache.clear(); ntCache.clear();
        host.panes().forEach(p => { if (p.cfg.scripts?.some(x => x.id === id)) p.set({ scripts: p.cfg.scripts!.filter(x => x.id !== id) }) });
        const next = Object.keys(scripts)[0]; if (next) open(next); else { editingId = ''; editor?.setValue(NEW_INDICATOR); $('#pnName').textContent = 'Untitled' }
      } }] : []),
    ]);
  };
  $('#inputsReset').onclick = () => { if (inputsCtx) { const { p, id } = inputsCtx; p.set({ scripts: p.cfg.scripts!.map(x => x.id === id ? { ...x, inputs: {} } : x) }); setTimeout(() => openInputs(p, id), 300) } };
  $('#inputsForm').oninput = e => {
    if (!inputsCtx) return;
    const i = e.target as HTMLInputElement, { p, id } = inputsCtx;
    const v: PineValue = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value;
    p.set({ scripts: p.cfg.scripts!.map(x => x.id === id ? { ...x, inputs: { ...x.inputs, [i.dataset.in!]: v } } : x) });
  };
}
const debounce = (fn: () => void, ms: number) => { let t = 0; return () => { clearTimeout(t); t = window.setTimeout(fn, ms) } };

// ---------- inputs dialog ----------
let inputsCtx: { p: ChartPane; id: string } | null = null;
export function openInputs(p: ChartPane, id: string) {
  const run = p.scriptRuns.find(r => r.id === id);
  if (!run?.out) return toast(run?.error ? `Script error: ${run.error.msg}` : 'Script has not run yet');
  inputsCtx = { p, id };
  $('#inputsTitle').textContent = `${run.name} · Inputs`;
  let group = '';
  $('#inputsForm').innerHTML = run.out.inputs.map(inp => {
    const head = inp.group && inp.group !== group ? `<h4>${esc((group = inp.group))}</h4>` : '';
    const v = inp.value, idAttr = `in-${inp.id}`;
    const field = inp.options ? `<select id="${idAttr}" data-in="${inp.id}">${inp.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : inp.type === 'bool' ? `<input id="${idAttr}" type="checkbox" data-in="${inp.id}" ${v ? 'checked' : ''}>`
      : inp.type === 'color' ? `<input id="${idAttr}" type="color" data-in="${inp.id}" value="${esc(String(v).slice(0, 7))}">`
      : inp.type === 'int' || inp.type === 'float' || inp.type === 'price' ? `<input id="${idAttr}" type="number" data-in="${inp.id}" value="${esc(v)}" ${inp.min != null ? `min="${inp.min}"` : ''} ${inp.max != null ? `max="${inp.max}"` : ''} step="${inp.step ?? (inp.type === 'int' ? 1 : 'any')}" style="width:100px">`
      : inp.type === 'source' ? `<select id="${idAttr}" data-in="${inp.id}">${['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'].map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input id="${idAttr}" data-in="${inp.id}" value="${esc(v ?? '')}">`;
    return `${head}<label for="${idAttr}" title="${esc(inp.tooltip ?? '')}">${esc(inp.title)}</label>${field}`;
  }).join('') || '<span class="muted">This script has no inputs.</span>';
  $<HTMLDialogElement>('#inputsDlg').showModal();
}

// ---------- console + strategy tester ----------
export function renderPineResults(p: ChartPane) {
  const con = $('#pnConsole');
  const runs = p.scriptRuns;
  const editing = runs.find(r => r.id === editingId);
  if (editing?.error && editor && editing.error.kind !== 'syntax') editor.setErrors([{ line: editing.error.line, col: editing.error.col, msg: editing.error.msg }]);
  con.innerHTML = runs.map(r => [
    r.error ? `<div class="err">${esc(r.name)}: ${r.error.kind} error${r.error.line ? ` at ${r.error.line}:${r.error.col}` : ''} — ${esc(r.error.msg)}</div>` : `<div class="muted">${esc(r.name)}: ran in ${r.ms.toFixed(1)} ms on ${p.vb().length} bars</div>`,
    ...(r.out?.warnings ?? []).map(w => `<div class="warn">${esc(r.name)}: ${esc(w)}</div>`),
    ...(r.out?.logs ?? []).slice(-40).map(l => `<div class="${l.level === 'error' ? 'err' : l.level === 'warning' ? 'warn' : ''}">[bar ${l.bar}] ${esc(l.msg)}</div>`),
  ].join('')).join('');
  // Several strategies on one chart: report the one open in the editor, else the most recently added.
  const isStrat = (r: typeof runs[number]) => !!(r.out?.broker || r.tester);
  const tester = runs.find(r => r.id === editingId && isStrat(r)) ?? runs.findLast(isStrat);
  renderTester(p, tester, tester?.out?.broker ? fromBroker(tester.out.broker, p.vb()) : tester?.tester);
}
