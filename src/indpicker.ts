// Indicator search: every library indicator and oscillator, filterable by name and category, with editable inputs.
import { GROUPS, LIB, indicatorDef, keyOf, type Group } from './indlib.ts';
import { esc } from './store.ts';

export interface PickerHost { keys(): string[]; set(keys: string[]): void; openPine(): void; derivs(anchor: HTMLElement): void }

type Tab = 'all' | 'overlay' | 'osc' | 'chart' | Group;
let dlg: HTMLDialogElement | null = null, tab: Tab = 'all', q = '', host: PickerHost;
const TABS: [Tab, string][] = [['all', 'All'], ['overlay', 'Overlays'], ['osc', 'Oscillators'], ...GROUPS.map(g => [g, g] as [Tab, string]), ['chart', 'On this chart']];

function row(d: (typeof LIB)[number], on: boolean) {
  const inputs = d.inputs.map((i, k) => `<label>${esc(i.name)}<input type="number" data-i="${k}" value="${i.def}" min="${i.min ?? 1}" step="${i.step ?? 1}"></label>`).join('');
  return `<div class="ip-row" data-id="${esc(d.id)}"><div class="ip-n"><b>${esc(d.name)}</b><span class="muted">${esc(d.group)} · ${d.pane ? 'separate pane' : 'on price'}</span></div><div class="ip-in">${inputs}</div><button type="button" data-a="add" class="${on ? '' : 'on'}">${on ? 'Add another' : 'Add'}</button></div>`;
}

function render() {
  if (!dlg) return;
  const cur = host.keys(), body = dlg.querySelector<HTMLElement>('.ip-list')!;
  dlg.querySelector('.ip-tabs')!.innerHTML = TABS.map(([t, n]) => `<button type="button" data-t="${esc(t)}" class="${t === tab ? 'on' : ''}">${esc(n)}${t === 'chart' ? ` (${cur.length})` : ''}</button>`).join('');
  if (tab === 'chart') {
    body.innerHTML = cur.map(k => `<div class="ip-row"><div class="ip-n"><b>${esc(indicatorDef(k)?.name ?? k)}</b></div><button type="button" data-a="rm" data-k="${esc(k)}">Remove</button></div>`).join('') || '<div class="muted">No indicators on this chart yet.</div>';
    return;
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = LIB.filter(d => (tab === 'all' || (tab === 'overlay' ? !d.pane : tab === 'osc' ? d.pane : d.group === tab)) && words.every(w => `${d.name} ${d.id} ${d.group}`.toLowerCase().includes(w)));
  body.innerHTML = shown.map(d => row(d, cur.includes(d.id))).join('') || '<div class="muted">Nothing matches. Scripts from TradingView can be pasted into the Pine Editor.</div>';
}

function add(r: HTMLElement) {
  const d = LIB.find(x => x.id === r.dataset.id)!, args = d.inputs.map((i, k) => { const v = Number(r.querySelector<HTMLInputElement>(`input[data-i="${k}"]`)?.value); return Number.isFinite(v) && v >= (i.min ?? 1) ? v : i.def });
  const key = keyOf(d.id, args), cur = host.keys();
  if (!cur.includes(key)) host.set([...cur, key]);
  render();
}

export function openIndicatorPicker(h: PickerHost) {
  host = h;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'wide ip';
    dlg.innerHTML = '<h3>Indicators <button type="button" class="x" data-a="close" aria-label="Close">×</button></h3><input class="ip-q" placeholder="Search indicators and oscillators…" aria-label="Search indicators"><div class="ip-tabs"></div><div class="ip-list"></div><div class="row"><span class="muted">Want one that is not here? Paste its Pine code from TradingView.</span><span class="grow"></span><button type="button" data-a="derivs" title="Open interest, funding, long/short ratio, CVD and liquidations">Derivatives…</button><button type="button" data-a="pine">Open Pine Editor</button></div>';
    document.body.append(dlg);
    dlg.onclick = e => {
      const el = e.target as HTMLElement, b = el.closest<HTMLElement>('button[data-a]'), t = el.closest<HTMLElement>('[data-t]');
      if (t) { tab = t.dataset.t as Tab; return render() }
      if (el === dlg || b?.dataset.a === 'close') return dlg!.close();
      if (b?.dataset.a === 'derivs') { dlg!.close(); return host.derivs(b) }
      if (b?.dataset.a === 'pine') { dlg!.close(); return host.openPine() }
      if (b?.dataset.a === 'rm') { host.set(host.keys().filter(k => k !== b.dataset.k)); return render() }
      if (b?.dataset.a === 'add') add(b.closest<HTMLElement>('.ip-row')!);
    };
    const input = dlg.querySelector<HTMLInputElement>('.ip-q')!;
    input.oninput = () => { q = input.value; if (tab === 'chart') tab = 'all'; render() };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const first = dlg!.querySelector<HTMLElement>('.ip-row[data-id]'); if (first) add(first) } };
  }
  dlg.showModal();
  dlg.querySelector<HTMLInputElement>('.ip-q')!.focus();
  render();
}
