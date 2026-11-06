// Connections: every live data provider in one place: free ones to switch on, paid ones to buy, keys to paste.
import { CATALOG, CATEGORY_NAMES, type Category } from './providers/catalog.ts';
import { api, serverMode } from './sync.ts';
import { esc, toast } from './store.ts';

interface View {
  id: string; name: string; category: Category; live: boolean; free: boolean; about: string; url: string; sponsored: boolean; available: boolean;
  perp: boolean; ccxt: string | null; testable: boolean; plans: { name: string; price: string; note?: string }[];
  keys: { name: string; label: string; secret?: boolean; saved: boolean }[];
}
export interface ConnectionsHost { openMarkets(exchange: string, perp: boolean): void }

let dlg: HTMLDialogElement | null = null, list: View[] = [], cat: Category | 'all' = 'all', q = '', host: ConnectionsHost;
const msgs = new Map<string, { ok: boolean; text: string }>();

// Standalone (no server): the same catalog, read-only, so people can still see where to get data.
const offline = (): View[] => CATALOG.map(p => ({
  id: p.id, name: p.name, category: p.category, live: p.live, free: p.free, about: p.about, url: p.site, sponsored: false, available: true,
  perp: p.category === 'perp', ccxt: p.ccxt ?? null, testable: false, plans: p.plans, keys: (p.keys ?? []).map(k => ({ ...k, saved: false })),
}));

async function load() {
  list = serverMode ? await api<View[]>('/api/providers').catch(() => offline()) : offline();
  render();
}

function chip(t: string, cls = '') { return `<span class="cx-chip ${cls}">${esc(t)}</span>` }

function card(p: View) {
  const status = p.live ? chip('Live now', 'ok') : chip('Adapter coming', 'warn');
  const plans = p.plans.map(x => `<li><b>${esc(x.name)}</b> <span class="cx-price">${esc(x.price)}</span>${x.note ? ` <span class="muted">· ${esc(x.note)}</span>` : ''}</li>`).join('');
  const m = msgs.get(p.id);
  const keys = p.keys.length
    ? `<div class="cx-keys">${p.keys.map(k => `<label>${esc(k.label)}<input data-k="${esc(k.name)}" type="${k.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${k.saved ? '•••••• saved (leave empty to keep)' : ''}"></label>`).join('')}
        <div class="row"><button type="button" data-a="save">Save key</button>${p.testable ? '<button type="button" data-a="test">Test</button>' : ''}${p.keys.some(k => k.saved) ? '<button type="button" data-a="clear">Remove key</button>' : ''}</div></div>`
    : '';
  const live = p.ccxt ? `<div class="row"><button type="button" data-a="markets">${p.perp ? 'Browse perpetuals' : 'Browse markets'}</button><button type="button" data-a="test">Test live</button></div>` : '';
  const off = serverMode ? '' : '<div class="muted">Connect to a server to save keys.</div>';
  return `<div class="cx-card${p.available ? '' : ' off'}" data-id="${esc(p.id)}">
    <div class="cx-h"><b>${esc(p.name)}</b>${p.perp ? chip('Perp') : ''}${chip(p.free ? 'Free tier' : 'Paid', p.free ? '' : 'paid')}${status}</div>
    <div class="muted">${esc(p.about)}</div>
    <ul class="cx-plans">${plans}</ul>
    <div class="row"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer${p.sponsored ? ' sponsored' : ''}">${p.free ? 'Sign up' : 'See plans and buy'} ↗</a>${p.sponsored ? '<span class="muted" title="The owner of this server earns a commission if you sign up through this link. It costs you nothing.">Referral link</span>' : ''}</div>
    ${live}${p.keys.length && serverMode ? keys : off}
    ${m ? `<div class="${m.ok ? 'up' : 'dn'}">${esc(m.text)}</div>` : ''}
  </div>`;
}

function render() {
  if (!dlg) return;
  const cats = ['all', ...new Set(list.map(p => p.category))] as (Category | 'all')[];
  const shown = list.filter(p => (cat === 'all' || p.category === cat) && (!q || `${p.name} ${p.id}`.toLowerCase().includes(q)));
  dlg.querySelector('.cx-tabs')!.innerHTML = cats.map(c => `<button type="button" data-c="${c}" class="${c === cat ? 'on' : ''}">${c === 'all' ? 'All' : esc(CATEGORY_NAMES[c])}</button>`).join('');
  const body = dlg.querySelector<HTMLElement>('.cx-list')!, keep = body.scrollTop;
  body.innerHTML = shown.map(card).join('') || '<div class="muted">Nothing matches.</div>';
  body.scrollTop = keep;
}

async function act(id: string, a: string, root: HTMLElement) {
  const p = list.find(x => x.id === id)!;
  const set = (ok: boolean, text: string) => { msgs.set(id, { ok, text }); render() };
  if (a === 'markets') { dlg!.close(); return host.openMarkets(p.ccxt!, p.perp) }
  if (a === 'save') {
    const values = Object.fromEntries([...root.querySelectorAll<HTMLInputElement>('input[data-k]')].map(i => [i.dataset.k!, i.value.trim()]));
    try { await api(`/api/providers/${id}/keys`, { method: 'PUT', body: { values } }); msgs.delete(id); toast('Key saved (encrypted on the server)'); await load() }
    catch (e) { set(false, (e as Error).message) }
  } else if (a === 'clear') {
    try { await api(`/api/providers/${id}/keys`, { method: 'DELETE' }); msgs.delete(id); await load() } catch (e) { set(false, (e as Error).message) }
  } else if (a === 'test') {
    set(true, 'Testing…');
    try { const r = await api<{ ok: boolean; message: string }>(`/api/providers/${id}/test`, { method: 'POST', body: {} }); set(r.ok, r.message) }
    catch (e) { set(false, (e as Error).message) }
  }
}

export function openConnections() {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'wide cx';
    dlg.innerHTML = '<h3>Connections <button type="button" class="x" data-a="close" aria-label="Close">×</button></h3><div class="muted">Live data providers. Free ones work now; for paid ones, pick a plan on the provider’s site, then paste the key here.</div><input class="cx-q" placeholder="Search providers…" aria-label="Search providers"><div class="cx-tabs"></div><div class="cx-list"></div>';
    document.body.append(dlg);
    dlg.onclick = e => {
      const el = e.target as HTMLElement, c = el.closest<HTMLElement>('[data-c]');
      if (el.dataset.a === 'close' || el === dlg) return dlg!.close();
      if (c) { cat = c.dataset.c as Category | 'all'; return render() }
      const b = el.closest<HTMLElement>('button[data-a]'), card = el.closest<HTMLElement>('.cx-card');
      if (b && card) void act(card.dataset.id!, b.dataset.a!, card);
    };
    (dlg.querySelector('.cx-q') as HTMLInputElement).oninput = e => { q = (e.target as HTMLInputElement).value.trim().toLowerCase(); render() };
  }
  dlg.showModal();
  void load();
}
export const initConnections = (h: ConnectionsHost) => { host = h };
