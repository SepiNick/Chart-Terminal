// Accounts side panel (docs/phase6-contracts.md): the paper account and exchange TESTNET accounts, the guardian check,
// guard settings, and per-account balances / positions / open orders / fills of the active account.
// API keys are read from the add form once, sent in one POST and the inputs are cleared: nothing is kept in the browser.
import type { BrokerAccount, BrokerId, Guard, GuardianReport, Market, OrderKind } from './types.ts';
import { activeBroker, allBrokers, onBrokers, setActiveBroker } from './registry.ts';
import { addAccount, checkAccount, deleteAccount, loadAccounts, saveAccount, tripReset } from './remote.ts';
import { dialog, injectStyle } from '../login.ts';
import { serverMode } from '../sync.ts';
import { $, esc, toast } from '../store.ts';

const EXCHANGES: { id: Exclude<BrokerId, 'paper'>; name: string; markets: Market[]; pass?: boolean; keys: string }[] = [
  { id: 'binance', name: 'Binance spot testnet', markets: ['spot'], keys: 'testnet.binance.vision — log in with GitHub, “Generate HMAC_SHA256 Key”' },
  { id: 'binanceusdm', name: 'Binance USDⓈ-M futures demo trading', markets: ['futures'], keys: 'binance.com → Demo Trading → API Management (the old testnet.binancefuture.com keys no longer work with the server)' },
  { id: 'bybit', name: 'Bybit testnet', markets: ['spot', 'futures'], keys: 'testnet.bybit.com — a separate testnet account; API under your profile' },
  { id: 'okx', name: 'OKX demo trading', markets: ['spot', 'futures'], pass: true, keys: 'okx.com → Trade → Demo trading → Personal center → Demo trading API' },
  // KuCoin left out: CCXT 4.5 has no sandbox for it, and the server refuses it.
  { id: 'nobitex', name: 'Nobitex testnet', markets: ['spot'], keys: 'testnet.nobitex.ir — sign up, then API token in the profile' },
];
const exName = (b: BrokerId) => (b === 'paper' ? 'Paper' : EXCHANGES.find(e => e.id === b)?.name ?? b);
const STATUS: Record<BrokerAccount['status'], string> = { active: 'active', pending: 'pending check', tripped: 'tripped', disabled: 'disabled', error: 'error' };

const CSS = `
#s-accts table{width:100%}#s-accts td,#s-accts th{padding:3px 4px;white-space:nowrap}#s-accts h4{margin:10px 0 4px;font-size:12px;color:var(--muted)}
#s-accts tr.cur td:first-child{box-shadow:inset 2px 0 var(--accent)}#s-accts tr[data-id]{cursor:pointer}
.bk-b{font-size:10px;padding:1px 5px;border-radius:8px;border:1px solid currentColor}
.bk-b.active{color:var(--up)}.bk-b.pending,.bk-b.disabled{color:var(--muted)}.bk-b.tripped,.bk-b.error{color:var(--down)}
.bk-note{border-left:3px solid var(--accent);padding:4px 8px;margin:6px 0;line-height:1.4}
.ct-dlg .bk-chk li{list-style:none;margin:3px 0}.ct-dlg .bk-chk{padding:0}.bk-ok{color:var(--up)}.bk-no{color:var(--down)}`;

let unsub = () => {};
const visible = () => $('#s-accts')?.classList.contains('on');

export function initAccountsUI() {
  injectStyle();
  const s = document.createElement('style'); s.textContent = CSS; document.head.append(s);
  onBrokers(() => { unsub(); unsub = activeBroker()?.onChange(() => renderAccounts()) ?? (() => {}); renderAccounts() });
  $('#s-accts').onclick = onClick;
  if (serverMode) loadAccounts().catch(e => toast(`Exchange accounts: ${(e as Error).message}`));
}

/** Draw the panel (cheap; called on every state change of the active account while visible). */
export function renderAccounts() {
  if (!visible()) return;
  const act = activeBroker(), list = allBrokers();
  const rows = list.map(b => {
    const a = b.account;
    return `<tr data-id="${esc(a.id)}" class="${a.id === act?.account.id ? 'cur' : ''}" title="Click to trade on this account">
      <td>${esc(a.label)}<br><span class="muted">${esc(exName(a.broker))}${a.broker === 'paper' ? '' : ' · ' + esc(a.market)}</span></td>
      <td><span class="bk-b ${esc(a.status)}">${esc(STATUS[a.status] ?? a.status)}</span></td>
      <td style="text-align:right">${a.broker === 'paper' ? '' : `<button class="x" data-a="check" data-id="${esc(a.id)}" title="Guardian check and risk limits">🛡</button><button class="x" data-a="del" data-id="${esc(a.id)}" title="Delete this account and its keys">✕</button>`}</td></tr>`;
  }).join('');
  $('#s-accts').innerHTML = `<h3>Accounts<span class="grow"></span>${serverMode ? '<button class="x" data-a="add" title="Add an exchange testnet account">＋ Testnet</button><button class="x" data-a="reload" title="Reload from the server">⟳</button>' : ''}</h3>
    ${serverMode ? '' : '<div class="muted bk-note">Exchange testnet accounts need the server (they trade from there). The paper account works everywhere.</div>'}
    <table>${rows || '<tr><td class="muted">No accounts.</td></tr>'}</table>${act ? details() : ''}`;
}

function details() {
  const b = activeBroker()!, a = b.account, s = b.state();
  const f = (v: number | undefined, d = 2) => (v == null || !isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d }));
  const px = (v?: number) => f(v, 8);
  let status = '';
  if (a.status === 'tripped') status = `Daily loss limit (${f(a.guard.maxDailyLossPct)}%) reached: only closing / reduce-only orders until ${esc(new Date(tripReset()).toLocaleString())} (next UTC day).`;
  else if (a.status === 'pending') status = 'Not active yet: run the guardian check (🛡) to enable trading.';
  else if (a.status === 'error') status = `Error: ${esc(a.error ?? 'unknown')}`;
  else if (a.status === 'disabled') status = 'Disabled.';
  if (!s) return `<h4>${esc(a.label)}</h4>${status ? `<div class="bk-note">${status}</div>` : ''}<div class="muted">Loading…</div>`;
  const kind = (k: OrderKind, ro?: boolean) => k.replace('_', '-') + (ro ? ' (reduce)' : '');
  const open = s.orders.filter(o => o.status === 'open');
  return `<h4>${esc(a.label)}${s.equity != null ? ` · equity ${esc(f(s.equity))}` : ''}</h4>${status ? `<div class="bk-note">${status}</div>` : ''}
    <h4>Balances</h4><table>${s.balances.filter(x => x.free || x.locked).map(x => `<tr><td>${esc(x.asset)}</td><td>${esc(f(x.free, 8))}</td><td class="muted">${x.locked ? esc(f(x.locked, 8)) + ' locked' : ''}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
    <h4>Positions</h4><table>${s.positions.map(p => `<tr><td>${esc(p.sym)}</td><td class="${p.qty > 0 ? 'up' : 'dn'}">${esc(f(p.qty, 8))}</td><td>@ ${esc(px(p.entry))}</td>
      <td class="${(p.upnl ?? 0) >= 0 ? 'up' : 'dn'}">${p.upnl != null ? esc(f(p.upnl)) : ''}</td><td><button class="x" data-a="close" data-sym="${esc(p.sym)}" title="Close at market">Close</button></td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
    <h4>Open orders</h4><table>${open.map(o => `<tr title="${esc(o.error ?? '')}"><td>${esc(o.sym)}</td><td class="${o.side === 'buy' ? 'up' : 'dn'}">${esc(o.side)}</td><td>${esc(kind(o.kind, o.reduceOnly))}</td>
      <td>${esc(f(o.qty - o.filled, 8))}</td><td>${esc(px(o.price ?? o.stopPrice))}</td><td><button class="x" data-a="cancel" data-oid="${esc(o.id)}" title="Cancel">✕</button></td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>
    <h4>Recent fills</h4><table>${s.fills.slice(-20).reverse().map(x => `<tr><td>${esc(new Date(x.ts).toLocaleTimeString())}</td><td>${esc(x.sym)}</td><td class="${x.side === 'buy' ? 'up' : 'dn'}">${esc(x.side)}</td>
      <td>${esc(f(x.qty, 8))}</td><td>@ ${esc(px(x.price))}</td><td class="${(x.realized ?? 0) >= 0 ? 'up' : 'dn'}">${x.realized ? esc(f(x.realized)) : ''}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table>`;
}

async function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement, btn = t.closest<HTMLElement>('[data-a]'), b = activeBroker();
  const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && toast(ok), x => toast((x as Error).message, 6000));
  if (!btn) { const id = t.closest<HTMLElement>('tr[data-id]')?.dataset.id; if (id) { setActiveBroker(id); activeBroker()?.refresh().catch(() => {}) } return }
  const id = btn.dataset.id!;
  switch (btn.dataset.a) {
    case 'add': return addDialog();
    case 'reload': return void run(loadAccounts());
    case 'check': return checkDialog(id);
    case 'del': {
      const a = allBrokers().find(x => x.account.id === id)?.account;
      if (a && confirm(`Delete “${a.label}” (${exName(a.broker)})? Its API keys are erased from the server.`)) void run(deleteAccount(id), 'Account deleted');
      return;
    }
    case 'close': if (b && confirm(`Close ${btn.dataset.sym} at market on ${b.account.label}?`)) void run(b.closePosition(btn.dataset.sym!), 'Close sent'); return;
    case 'cancel': if (b) void run(b.cancel(btn.dataset.oid!)); return;
  }
}

function addDialog() {
  const opts = EXCHANGES.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  dialog('Add testnet account', `<div class="bk-note"><b>Testnet / demo only.</b> Real-money keys are refused. Create the key on the exchange's test site,
      <b>without withdraw or transfer permission</b>. <span id="bkWhere" class="muted"></span></div>
    <div class="form">
      <label>Exchange</label><select name="broker">${opts}</select>
      <label>Market</label><select name="market"></select>
      <label>Label</label><input name="label" maxlength="40" autocomplete="off">
      <label>API key</label><input type="password" name="apiKey" autocomplete="off" spellcheck="false">
      <label>Secret</label><input type="password" name="secret" autocomplete="off" spellcheck="false">
      <label class="bk-pass">Passphrase</label><input class="bk-pass" type="password" name="passphrase" autocomplete="off" spellcheck="false"></div>
    <p class="muted">The keys are sent once to your server, stored encrypted there and never shown again.</p>
    <div class="ct-err"></div><div class="row"><span class="grow"></span><button type="button" data-x>Cancel</button><button class="on">Add</button></div>`, (f, close) => {
    const el = (n: string) => f.elements.namedItem(n) as HTMLInputElement;
    const pick = () => {
      const x = EXCHANGES.find(e => e.id === el('broker').value)!;
      el('market').innerHTML = x.markets.map(m => `<option>${m}</option>`).join('');
      f.querySelectorAll<HTMLElement>('.bk-pass').forEach(n => n.hidden = !x.pass);
      $('#bkWhere', f).textContent = `Keys: ${x.keys}.`;
      if (!el('label').dataset.typed) el('label').value = x.name.replace(/ (testnet|sandbox|demo trading|futures demo trading)$/, '') + ' test';
    };
    el('broker').onchange = pick; el('label').oninput = () => { el('label').dataset.typed = '1' }; pick();
    f.querySelector<HTMLButtonElement>('[data-x]')!.onclick = () => { wipe(); close() };
    const wipe = () => { for (const n of ['apiKey', 'secret', 'passphrase']) el(n).value = '' };
    f.onsubmit = async e => {
      e.preventDefault();
      const err = f.querySelector('.ct-err')!, x = EXCHANGES.find(e => e.id === el('broker').value)!;
      const input = { broker: x.id, market: el('market').value as Market, label: el('label').value.trim() || x.name, apiKey: el('apiKey').value.trim(), secret: el('secret').value.trim(), passphrase: x.pass ? el('passphrase').value : undefined };
      if (!input.apiKey || !input.secret || (x.pass && !input.passphrase)) { err.textContent = `Enter the API key, secret${x.pass ? ' and passphrase' : ''}`; return }
      wipe();   // the keys leave the page with this request only
      try { const a = await addAccount(input); close(); toast('Account added — run the guardian check'); checkDialog(a.id) }
      catch (x) { err.textContent = `${(x as Error).message} — enter the keys again`; }
    };
  });
}

function checkDialog(id: string) {
  const a = allBrokers().find(x => x.account.id === id)?.account; if (!a) return;
  const g = a.guard;
  dialog(`Guardian check · ${a.label}`, `<p class="muted">${esc(exName(a.broker))} · ${esc(a.market)} · status <span class="bk-b ${esc(a.status)}">${esc(STATUS[a.status] ?? a.status)}</span></p>
    <div class="form">
      <label>Max daily loss %</label><input type="number" name="maxDailyLossPct" min="0.1" max="100" step="0.1" value="${esc(g.maxDailyLossPct)}" title="No new risk once today's loss reaches this % of start-of-day equity (resets next UTC day)">
      <label>Max position %</label><input type="number" name="maxPositionPct" min="0.1" max="100" step="0.1" value="${esc(g.maxPositionPct)}" title="A position's notional may not exceed this % of equity">
      <label>Require stop-loss</label><input type="checkbox" name="requireStop" ${g.requireStop ? 'checked' : ''}></div>
    <p><label><input type="checkbox" name="confirmedNoWithdraw" ${g.confirmedNoWithdraw ? 'checked' : ''}> I confirm this API key has <b>no withdraw or transfer permission</b>.</label></p>
    <ul class="bk-chk"></ul><div class="ct-err"></div>
    <div class="row"><span class="grow"></span><button type="button" data-x>Close</button><button type="button" data-save>Save limits</button><button class="on">Save &amp; run check</button></div>`, (f, close) => {
    const el = (n: string) => f.elements.namedItem(n) as HTMLInputElement, err = f.querySelector('.ct-err')!;
    const guard = (): Guard => ({ maxDailyLossPct: +el('maxDailyLossPct').value, maxPositionPct: +el('maxPositionPct').value, requireStop: el('requireStop').checked, confirmedNoWithdraw: el('confirmedNoWithdraw').checked });
    const save = () => saveAccount(id, { guard: guard() });
    f.querySelector<HTMLButtonElement>('[data-x]')!.onclick = close;
    f.querySelector<HTMLButtonElement>('[data-save]')!.onclick = () => { err.textContent = ''; save().then(() => toast('Limits saved'), x => { err.textContent = (x as Error).message }) };
    f.onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      let r: GuardianReport;
      try { await save(); r = await checkAccount(id) } catch (x) { err.textContent = (x as Error).message; return }
      f.querySelector('.bk-chk')!.innerHTML = r.items.map(i => `<li><b class="${i.ok ? 'bk-ok' : 'bk-no'}">${i.ok ? 'PASS' : 'FAIL'}</b> ${esc(i.label)}${i.detail ? ` <span class="muted">— ${esc(i.detail)}</span>` : ''}</li>`).join('')
        + `<li><b>${r.ok ? 'Account active — you can trade on it.' : 'Still pending: fix the failed items and run the check again.'}</b></li>`;
    };
  });
}
