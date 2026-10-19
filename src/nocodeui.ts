// Dialog for the no-code strategy builder. Produces Pine source via tester/nocode.ts.
import { OPERANDS, OPS, defaultSpec, mirror, toPine, type Cond, type NoCodeSpec, type Operand, type Rule } from './tester/nocode.ts';
import { $, esc, store } from './store.ts';

type RuleKey = 'longEntry' | 'longExit' | 'shortEntry' | 'shortExit';
const RULES: [RuleKey, string, string][] = [
  ['longEntry', 'Enter long when', 'long'], ['longExit', 'Exit long when', 'long'],
  ['shortEntry', 'Enter short when', 'short'], ['shortExit', 'Exit short when', 'short'],
];
let spec: NoCodeSpec = store.get('nocode', defaultSpec());
let onCreate: (src: string) => void = () => {};

const lenOf = (k: Operand['kind']) => OPERANDS.find(o => o.kind === k)?.len;
function operandHtml(o: Operand, path: string) {
  const extra = o.kind === 'value' ? `<input type="number" step="any" data-p="${path}.value" value="${o.value ?? 0}" style="width:80px">`
    : o.len != null ? `<input type="number" min="1" data-p="${path}.len" value="${o.len}" style="width:56px" title="Length">` : '';
  return `<select data-p="${path}.kind">${OPERANDS.map(x => `<option value="${x.kind}" ${x.kind === o.kind ? 'selected' : ''}>${x.label}</option>`).join('')}</select>${extra}`;
}
function ruleHtml(key: RuleKey, label: string, r: Rule) {
  const rows = r.conds.map((c, i) => `<div class="nc-cond">${operandHtml(c.a, `${key}.${i}.a`)}<select data-p="${key}.${i}.op">${OPS.map(o => `<option value="${o.op}" ${o.op === c.op ? 'selected' : ''}>${o.label}</option>`).join('')}</select>${operandHtml(c.b, `${key}.${i}.b`)}<button type="button" class="x" data-del="${key}.${i}" title="Remove">✕</button></div>`).join('');
  return `<fieldset><legend>${label} <select data-p="${key}.join"><option value="and" ${r.join === 'and' ? 'selected' : ''}>all of</option><option value="or" ${r.join === 'or' ? 'selected' : ''}>any of</option></select></legend>
    ${rows || `<div class="muted">${key.endsWith('Exit') ? 'No condition — exits only by the opposite entry or stop/target.' : 'No condition — never enters.'}</div>`}
    <div class="row"><button type="button" data-add="${key}">＋ Condition</button>${key === 'shortEntry' || key === 'shortExit' ? `<button type="button" data-mirror="${key}">Mirror ${key === 'shortEntry' ? 'long entry' : 'long exit'}</button>` : ''}</div></fieldset>`;
}
function render() {
  const f = (k: keyof NoCodeSpec, label: string, attrs = '') => `<label>${label} <input type="number" step="any" min="0" data-p="${k}" value="${esc(String(spec[k]))}" ${attrs} style="width:80px"></label>`;
  $('#ncForm').innerHTML = `<div class="row wrap"><label class="grow">Name <input data-p="name" value="${esc(spec.name)}" style="flex:1"></label>
      <label>Direction <select data-p="direction">${['both', 'long', 'short'].map(d => `<option ${d === spec.direction ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div>
    ${RULES.filter(([, , side]) => spec.direction === 'both' || spec.direction === side).map(([k, label]) => ruleHtml(k, label, spec[k])).join('')}
    <fieldset><legend>Risk (0 = off)</legend><div class="row wrap">${f('stopPct', 'Stop loss %')}${f('takePct', 'Take profit %')}${f('trailPct', 'Trailing stop %')}</div></fieldset>
    <fieldset><legend>Properties</legend><div class="row wrap">${f('capital', 'Initial capital')}${f('sizePct', 'Order size % of equity')}${f('commissionPct', 'Commission %')}</div></fieldset>
    <details><summary class="muted">Generated Pine</summary><pre id="ncSrc"></pre></details>`;
  $('#ncSrc').textContent = toPine(spec);
}
/** Set a value by a dotted path like "longEntry.0.a.len" (rule paths go through .conds). */
function setPath(path: string, raw: string) {
  const p = path.split('.');
  if (p.length === 1) { (spec as unknown as Record<string, unknown>)[p[0]] = p[0] === 'name' || p[0] === 'direction' ? raw : Math.max(0, +raw || 0); return p[0] === 'direction' }
  const rule = spec[p[0] as RuleKey];
  if (p[1] === 'join') { rule.join = raw as Rule['join']; return false }
  const c = rule.conds[+p[1]];
  if (p[2] === 'op') { c.op = raw as Cond['op']; return false }
  const o = c[p[2] as 'a' | 'b'];
  if (p[3] === 'kind') { c[p[2] as 'a' | 'b'] = { kind: raw as Operand['kind'], len: lenOf(raw as Operand['kind']), value: raw === 'value' ? (o.value ?? 50) : undefined }; return true }
  (o as unknown as Record<string, number>)[p[3]] = +raw;
  return false;
}

export function initNoCode(create: (src: string) => void) {
  onCreate = create;
  const form = $('#ncForm');
  form.oninput = form.onchange = e => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.p) return;
    const rerender = setPath(el.dataset.p, el.value);
    store.set('nocode', spec);
    if (rerender && e.type === 'change') render(); else $('#ncSrc').textContent = toPine(spec);
  };
  form.onclick = e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.add) spec[b.dataset.add as RuleKey].conds.push({ a: { kind: 'close' }, op: 'crossAbove', b: { kind: 'sma', len: 50 } });
    else if (b.dataset.del) { const [k, i] = b.dataset.del.split('.'); spec[k as RuleKey].conds.splice(+i, 1) }
    else if (b.dataset.mirror) spec[b.dataset.mirror as RuleKey] = mirror(b.dataset.mirror === 'shortEntry' ? spec.longEntry : spec.longExit);
    else return;
    store.set('nocode', spec); render();
  };
  $('#ncReset').onclick = () => { spec = defaultSpec(); store.set('nocode', spec); render() };
  $('#ncCreate').onclick = () => { $<HTMLDialogElement>('#nocodeDlg').close(); onCreate(toPine(spec)) };
}
export function openNoCode() { render(); $<HTMLDialogElement>('#nocodeDlg').showModal() }
