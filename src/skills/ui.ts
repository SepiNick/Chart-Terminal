// The Skills panel: every in-app skill (src/skills/*) as a form and a result, drawn by one renderer. Inputs are kept
// per skill in this browser; results are recomputed on Run. Nothing here places orders: skills only propose.
import { $, esc, store } from '../store.ts';
import { SKILLS } from './index.ts';
import type { Ctx, Input, Result, Skill } from './types.ts';

let ctx: Ctx;
let cur = store.get<string>('skillCur', SKILLS[0]?.id ?? '');
const saved = store.get<Record<string, Record<string, unknown>>>('skillInputs', {});

export function initSkills(c: Ctx) {
  ctx = c;
  const box = $('#s-skills');
  box.innerHTML = `<h3>Skills <span class="muted">${SKILLS.length} · rules only, no AI</span></h3>
    <select id="skPick" aria-label="Skill">${[...new Set(SKILLS.map(s => s.group))].map(g => `<optgroup label="${esc(g)}">${SKILLS.filter(s => s.group === g).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}</select>
    <div id="skDesc" class="muted"></div><form id="skForm" class="form"></form><div class="row"><button id="skRun" class="on">Run</button><span class="grow"></span><button id="skReset" class="x" title="Back to the default inputs">Reset</button></div><div id="skOut"></div>`;
  $<HTMLSelectElement>('#skPick').onchange = e => { cur = (e.target as HTMLSelectElement).value; store.set('skillCur', cur); renderSkills() };
  $('#skRun').onclick = () => void run();
  $('#skReset').onclick = () => { delete saved[cur]; store.set('skillInputs', saved); renderSkills() };
  $('#skForm').onsubmit = e => { e.preventDefault(); void run() };
}

const skill = (): Skill => SKILLS.find(s => s.id === cur) ?? SKILLS[0];
function field(i: Input, v: unknown) {
  const val = v ?? i.default ?? '', id = `sk_${i.key}`;
  const control = i.type === 'bool' ? `<input type="checkbox" id="${id}" data-k="${esc(i.key)}" ${val ? 'checked' : ''}>`
    : i.type === 'select' ? `<select id="${id}" data-k="${esc(i.key)}">${(i.options ?? []).map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
    : i.type === 'json' || i.type === 'symbols' ? `<textarea id="${id}" data-k="${esc(i.key)}" rows="${i.type === 'json' ? 5 : 2}" dir="ltr">${esc(typeof val === 'string' ? val : JSON.stringify(val, null, 1))}</textarea>`
    : `<input id="${id}" data-k="${esc(i.key)}" ${i.type === 'number' ? 'type="number" step="any"' : ''} value="${esc(val)}" ${i.optional ? 'placeholder="optional"' : ''}>`;
  return `<label class="field" for="${id}" title="${esc(i.hint ?? '')}">${esc(i.label)}${control}</label>`;
}
export function renderSkills() {
  if (!ctx) return;
  const s = skill(), v = saved[s.id] ?? {};
  $<HTMLSelectElement>('#skPick').value = s.id;
  $('#skDesc').innerHTML = `${esc(s.desc)} <span title="Installed skill this comes from">· ${esc(s.from)}</span>`;
  $('#skForm').innerHTML = s.inputs.map(i => field(i, v[i.key])).join('');
  $('#skOut').innerHTML = '';
}
function read(s: Skill): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const i of s.inputs) {
    const el = document.querySelector<HTMLInputElement>(`#skForm [data-k="${CSS.escape(i.key)}"]`);
    if (!el) continue;
    v[i.key] = i.type === 'bool' ? el.checked : el.value;
  }
  saved[s.id] = v; store.set('skillInputs', saved);
  return v;
}
async function run() {
  const s = skill(), out = $('#skOut');
  out.innerHTML = '<div class="muted">Running…</div>';
  try { out.innerHTML = view(await s.run(read(s), ctx)) }
  catch (e) { out.innerHTML = `<div class="dn">${esc((e as Error).message)}</div>` }
}
const tone = (t?: string) => (t === 'up' || t === 'dn' || t === 'warn' || t === 'muted' ? ` class="${t}"` : '');
export function view(r: Result): string {
  return (r.verdict ? `<div class="skv"><b${tone(r.verdict.tone)}>${esc(r.verdict.label)}</b>${r.verdict.detail ? ` <span class="muted">${esc(r.verdict.detail)}</span>` : ''}</div>` : '')
    + (r.kpis?.length ? `<div class="row wrap kpis">${r.kpis.map(k => `<div><span>${esc(k.label)}</span><b${tone(k.tone)}>${esc(k.value)}</b></div>`).join('')}</div>` : '')
    + (r.tables ?? []).map(t => `<h4>${esc(t.title)}</h4>${t.rows.length ? `<table class="scr"><tr>${t.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${t.rows.map(row => `<tr>${row.map(c => `<td>${esc(c ?? '–')}</td>`).join('')}</tr>`).join('')}</table>` : '<div class="muted">Nothing.</div>'}`).join('')
    + (r.notes ?? []).map(n => `<div class="muted">• ${esc(n)}</div>`).join('');
}
