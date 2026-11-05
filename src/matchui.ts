// Right after sign-in: bring this browser and the account in line without losing either side (design §4.2-4.5).
// Plans come from planMatch (pure). Every destructive choice first stores a restore point (30 days on the server) and can be undone.
import { api, downloadBackup, hydrate, localSnapshot, type ServerState } from './sync.ts';
import { dialog } from './login.ts';
import { esc, toast } from './store.ts';
import { syncServer } from './servers.ts';
import { uploadLocalMedia } from './journal/media.ts';
import { Conflict, createRestore, deleteRestore, getRestore, listRestores, writeBatch, type Write } from './syncapi.ts';
import { isEmptyDevice, mergeAll, newerAcct, planMatch, readOwner, summarize, writeOwner, type Meta } from './syncmerge.ts';

const values = (s: ServerState) => Object.fromEntries(Object.entries(s).map(([k, r]) => [k, r.value]));
const LIMIT_MB = (k: string) => (k === 'journal' ? 8 : 2);
const oversized = (v: Record<string, unknown>) => Object.keys(v).filter(k => JSON.stringify(v[k]).length > LIMIT_MB(k) * 1048576);
const touch = (userId: string) => writeOwner(localStorage, syncServer().id, userId);
const fresh = () => api<ServerState>('/api/state');

/** Make the account hold exactly `want` (keys missing from it are deleted). Retries on conflict with fresh revisions. */
async function replaceAccount(want: Record<string, unknown>) {
  for (let i = 0; ; i++) {
    const cur = await fresh(), w: Write[] = [];
    for (const [k, v] of Object.entries(want)) w.push({ key: k, value: v, baseRev: cur[k]?.rev ?? 0 });
    for (const k of Object.keys(cur)) if (!(k in want)) w.push({ key: k, value: null, baseRev: cur[k].rev });
    try { return await writeBatch(w) } catch (e) { if (!(e instanceof Conflict) || i >= 2) throw e }
  }
}
/** Merge and write; on 409 re-merge against the fresh account (merge is idempotent) up to 3 times. Nothing is half-written on a batch server. */
async function mergeInto(state: ServerState, acct: 'account' | 'device', skip: Set<string>): Promise<string[]> {
  for (let i = 0; ; i++) {
    const acc = values(state), dev = localSnapshot();
    const r = mergeAll(acc, dev, { accMeta: acc.syncmeta as Meta, devMeta: dev.syncmeta as Meta, acct });
    r.values.syncmeta = r.meta;
    const w: Write[] = Object.entries(r.values).filter(([k, v]) => !skip.has(k) && JSON.stringify(v) !== JSON.stringify(acc[k])).map(([k, v]) => ({ key: k, value: v, baseRev: state[k]?.rev ?? 0 }));
    try { await writeBatch(w); return r.notes }
    catch (e) { if (!(e instanceof Conflict) || i >= 2) throw e; state = await fresh() }
  }
}

export function matchOnSignIn(userId: string): Promise<void> {
  const run = () => doMatch(userId);
  return navigator.locks ? navigator.locks.request('ct-match', run) : run();   // two tabs signing in must not both ask
}
async function doMatch(userId: string) {
  let state = await fresh();
  const local = localSnapshot(), sid = syncServer().id;
  const plan = planMatch({ deviceEmpty: isEmptyDevice(local), accountEmpty: !Object.keys(state).length, own: readOwner(localStorage), server: sid, userId });
  if (plan === 'hydrate') { hydrate(state); touch(userId); return }
  if (plan === 'foreign') {
    // Another account's data is never put into this account's restore points; only an explicit merge adds it.
    if ((await foreignDialog()) === 'discard') { hydrate(state); touch(userId); return }
  }
  await uploadLocalMedia().catch(() => null);   // pictures first, so merged journals carry server ids
  state = await fresh();
  await matchDialog(state, userId);
}

function foreignDialog(): Promise<'discard' | 'merge'> {
  return new Promise(res => dialog('This browser holds data from another account', `
    <p>The data saved in this browser belongs to a different account (or server) than the one you just signed in to.
      It is not added to this account unless you choose so.</p>
    <div class="row wrap"><button type="button" data-a="backup">Download it as a backup file</button><span class="grow"></span>
      <button type="button" data-a="merge">Merge it into this account</button><button type="button" data-a="discard" class="on">Discard it</button></div>`, (f, close) => {
    f.onclick = e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'backup') downloadBackup();
      if (a === 'discard' || (a === 'merge' && confirm('Add the data in this browser to the account you just signed in to?'))) { close(); res(a as 'discard' | 'merge') }
    };
  }, false));
}

function matchDialog(state: ServerState, userId: string): Promise<void> {
  const acc = values(state), dev = localSnapshot(), sa = summarize(acc), sd = summarize(dev);
  let acct: 'account' | 'device' = newerAcct(acc.acct, dev.acct);
  const preview = mergeAll(acc, dev, { accMeta: acc.syncmeta as Meta, devMeta: dev.syncmeta as Meta, acct }), sm = summarize(preview.values), big = oversized(preview.values);
  const row = (l: string, k: 'trades' | 'watch' | 'layouts' | 'scripts' | 'drawings' | 'templates' | 'alerts') => `<tr><td>${l}</td><td>${sd[k]}</td><td>${sa[k]}</td><td class="muted">${sm[k]}</td></tr>`;
  const money = (n?: number) => (n === undefined ? '-' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  return new Promise(res => dialog('Match this device with your account', `
    <p>This device has <b>${sd.total}</b> items, your account has <b>${sa.total}</b>. Nothing is deleted without a restore point you can undo for 30 days.</p>
    <table><tr><th></th><th>This device</th><th>Your account</th><th>Merged</th></tr>
      ${row('Journal trades', 'trades')}${row('Watchlist symbols', 'watch')}${row('Layouts', 'layouts')}${row('Scripts', 'scripts')}${row('Drawings', 'drawings')}${row('Templates', 'templates')}${row('Alerts', 'alerts')}
      <tr><td>Paper account</td><td>${money(sd.cash)} · ${sd.fills} fills</td><td>${money(sa.cash)} · ${sa.fills} fills</td><td class="muted">one of them</td></tr></table>
    <p>Paper account (cash and positions are a running ledger, so they are never combined):
      <label><input type="radio" name="acct" value="account" ${acct === 'account' ? 'checked' : ''}> keep the account's</label>
      <label><input type="radio" name="acct" value="device" ${acct === 'device' ? 'checked' : ''}> keep this device's</label></p>
    ${big.length ? `<p class="ct-err">Too big to merge: ${esc(big.join(', '))}. Those stay as they are on each side (this device's copy stays here only).</p>` : ''}
    <p class="muted" data-msg></p>
    <div class="row wrap"><button type="button" data-a="backup">Download a backup of this device first</button><span class="grow"></span>
      <button type="button" data-a="account">Use account data</button><button type="button" data-a="device">Use this device's data</button><button type="button" data-a="merge" class="on">Merge (recommended)</button></div>`, (f, close) => {
    const msg = f.querySelector<HTMLElement>('[data-msg]')!, btns = [...f.querySelectorAll<HTMLButtonElement>('button')];
    f.addEventListener('change', e => { const t = e.target as HTMLInputElement; if (t.name === 'acct') acct = t.value as typeof acct });
    f.onclick = async e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'backup') return downloadBackup();
      if (!a) return;
      if (a === 'device' && !confirm(`This replaces ${sa.total} items on your account with this device's data. Continue?`)) return;
      btns.forEach(b => (b.disabled = true)); msg.className = 'muted'; msg.textContent = 'Working…';
      try {
        let rid: string | number | undefined;
        const keep = async (label: string, v: Record<string, unknown>, main = true) => {
          if (!Object.keys(v).length) return;
          try { const id = (await createRestore(label, v)).id; if (main) rid = id } catch { if (main) { downloadBackup(); toast('Restore point could not be saved on the server; a backup file was downloaded instead', 7000) } }
        };
        let after: ServerState;
        if (a === 'account') { await keep('This device before using the account', dev); after = state }
        else if (a === 'device') { await keep('Account before using this device', acc); await replaceAccount(dev); after = await fresh() }
        else {
          await keep('This device before merge', dev, false);
          await keep('Account before merge', acc);
          const notes = await mergeInto(state, acct, new Set(big)); after = await fresh();
          if (notes.length) toast(notes.slice(0, 3).join(' · '), 9000);
        }
        hydrate(after);
        if (a === 'merge') for (const k of big) if (dev[k] !== undefined) try { localStorage.setItem('ct.' + k, JSON.stringify(dev[k])) } catch {}
        touch(userId); close(); res();
        if (rid !== undefined) undoToast(rid);
      } catch (x) {
        msg.className = 'ct-err';
        msg.textContent = x instanceof Conflict ? 'Your account changed on another device while merging. Nothing was lost; try again.' : `Could not finish: ${(x as Error).message}. Nothing on your account was lost.`;
        btns.forEach(b => (b.disabled = false));
      }
    };
  }, false));
}
function undoToast(id: string | number) {
  const box = document.getElementById('toast'); if (!box) return;
  const d = document.createElement('div'); d.textContent = 'Done. ';
  const b = document.createElement('button'); b.textContent = 'Undo'; b.onclick = () => { d.remove(); void restoreTo(id) };
  d.append(b); box.append(d); setTimeout(() => d.remove(), 30_000);
}
/** Put the account back to a restore point (after saving the current state as a new one, so this is undoable too), then reload. */
export async function restoreTo(id: string | number) {
  try {
    const want = await getRestore(id);
    await createRestore('Before restore', values(await fresh()));
    await replaceAccount(want);
    hydrate(await fresh());
    location.reload();
  } catch (e) { toast(`Restore failed: ${(e as Error).message}`, 6000) }
}
export async function restorePoints() {
  let list; try { list = await listRestores() } catch (e) { return toast((e as Error).message) }
  const t = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  dialog('Restore points', `${list.length ? `<table>${list.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(t(r.at))}</td><td style="white-space:nowrap"><button type="button" data-r="${esc(r.id)}">Restore</button> <button type="button" data-d="${esc(r.id)}">Delete</button></td></tr>`).join('')}</table>` : '<p class="muted">No restore points.</p>'}
    <p class="muted">Kept for 30 days. Restoring first saves the current state as a new restore point.</p><div class="row"><span class="grow"></span><button class="on">Close</button></div>`, (f, close) => {
    f.onsubmit = e => { e.preventDefault(); close() };
    f.onclick = async e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-r],[data-d]'); if (!el) return;
      if (el.dataset.r && confirm('Replace your account data with this restore point?')) { close(); await restoreTo(el.dataset.r) }
      if (el.dataset.d) { await deleteRestore(el.dataset.d).catch(() => {}); el.closest('tr')?.remove() }
    };
  });
}
