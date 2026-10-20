// "Server & notifications" dialog (docs/phase5-contracts.md §9): Telegram, email, webhook, push, trade recording, LAN access.
// Every section loads and saves on its own, so one unavailable server module doesn't break the rest.
import { $, esc, fmtVol } from './store.ts';
import { api, serverMode } from './sync.ts';
import { pushState, enablePush, disablePush, type PushState } from './push.ts';

interface NotifySettings {
  telegram: { chatId?: string; hasToken: boolean };
  email: { host?: string; port?: number; secure?: boolean; user?: string; from?: string; to?: string; hasPassword: boolean };
  webhook: { url?: string };
  push: { subscriptions: { endpoint: string; agent?: string; created?: number; lastOk?: number }[] };
}
interface Delivery { channel: string; ok: boolean; error?: string }
interface Recorder { symbols: string[]; retentionDays: number; stats: { sym: string; from?: number; to?: number; count: number; approxBytes: number }[] }
interface Lan { enabled: boolean; port: number; urls: string[]; caFingerprint?: string }

const val = (id: string) => $<HTMLInputElement>(id).value.trim();
const status = (id: string, msg: string, ok?: boolean) => { const el = $(id); el.textContent = msg; el.className = 'st' + (ok === true ? ' up' : ok === false ? ' dn' : ' muted') };
const errMsg = (e: unknown) => (e as Error).message || String(e);
let ns: NotifySettings | null = null;

export function initSettingsUI() {
  $('#srvBtn').onclick = openServerSettings;
  $('#sTelegram').onsubmit = e => { e.preventDefault(); saveTelegram() };
  $('#sEmail').onsubmit = e => { e.preventDefault(); saveEmail() };
  $('#sWebhook').onsubmit = e => { e.preventDefault(); saveSection('#whSt', { webhook: { url: val('#whUrl') } }) };
  $('#sRecorder').onsubmit = e => { e.preventDefault(); saveRecorder() };
  $('#sPush').onsubmit = e => e.preventDefault();
  $('#sLan').onsubmit = e => e.preventDefault();
  $('#tgDel').onclick = () => { if (confirm('Remove the saved Telegram bot token?')) saveSection('#tgSt', { telegram: { token: null } }) };
  $('#emDel').onclick = () => { if (confirm('Remove the saved SMTP password?')) saveSection('#emSt', { email: { password: null } }) };
  $('#tgPick').onclick = pickChat;
  $('#tgChats').onclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-chat]')?.dataset.chat; if (id) { $<HTMLInputElement>('#tgChat').value = id; $('#tgChats').innerHTML = ''; saveTelegram() } };
  $('#srvDlg').addEventListener('click', e => { const ch = (e.target as HTMLElement).dataset.test; if (ch) test(ch) });
  $('#pushBtn').onclick = togglePush;
  $('#notifBtn').onclick = async () => { try { await Notification.requestPermission() } catch {} renderNotif() };
  $('#lanOn').onchange = async e => {
    const on = (e.target as HTMLInputElement).checked;
    try { await api('/api/lan', { body: { enabled: on } }); status('#lanSt', on ? 'Enabled' : 'Disabled', true); loadLan() }
    catch (err) { (e.target as HTMLInputElement).checked = !on; status('#lanSt', errMsg(err), false) }
  };
}

export function openServerSettings() {
  $('#srvOff').hidden = serverMode; $('#srvBody').hidden = !serverMode;
  $<HTMLDialogElement>('#srvDlg').showModal();
  if (!serverMode) return;
  for (const id of ['#tgSt', '#emSt', '#whSt', '#recSt', '#lanSt']) status(id, '');
  loadNotify(); loadRecorder(); loadLan(); renderPush(); renderNotif();
}

// ---------- Telegram / email / webhook ----------
async function loadNotify() {
  try { ns = await api<NotifySettings>('/api/notify/settings') } catch (e) { for (const id of ['#tgSt', '#emSt', '#whSt']) status(id, errMsg(e), false); return }
  const t = ns.telegram ?? { hasToken: false }, m = ns.email ?? { hasPassword: false };
  const tok = $<HTMLInputElement>('#tgToken'); tok.value = ''; tok.placeholder = t.hasToken ? 'Saved — type to replace' : '123456789:AA…';
  $('#tgDel').hidden = !t.hasToken;
  $<HTMLInputElement>('#tgChat').value = t.chatId ?? '';
  $<HTMLInputElement>('#emHost').value = m.host ?? ''; $<HTMLInputElement>('#emPort').value = m.port ? String(m.port) : '';
  $<HTMLInputElement>('#emSecure').checked = m.secure ?? true; $<HTMLInputElement>('#emUser').value = m.user ?? '';
  const pw = $<HTMLInputElement>('#emPass'); pw.value = ''; pw.placeholder = m.hasPassword ? 'Saved — type to replace' : '';
  $('#emDel').hidden = !m.hasPassword;
  $<HTMLInputElement>('#emFrom').value = m.from ?? ''; $<HTMLInputElement>('#emTo').value = m.to ?? '';
  $<HTMLInputElement>('#whUrl').value = ns.webhook?.url ?? '';
  $('#tgChats').innerHTML = '';
}
/** PUT a partial settings object; secret fields are only sent when typed (write-only). */
async function saveSection(st: string, patch: Record<string, unknown>) {
  status(st, 'Saving…');
  try { await api('/api/notify/settings', { method: 'PUT', body: patch }); await loadNotify(); status(st, 'Saved', true); return true }
  catch (e) { status(st, errMsg(e), false); return false }
}
function saveTelegram() {
  const token = val('#tgToken');
  return saveSection('#tgSt', { telegram: { chatId: val('#tgChat'), ...(token ? { token } : {}) } });
}
function saveEmail() {
  const port = val('#emPort'), password = $<HTMLInputElement>('#emPass').value;
  if (port && !(+port >= 1 && +port <= 65535 && Number.isInteger(+port))) { status('#emSt', 'Port must be 1–65535', false); return Promise.resolve(false) }
  return saveSection('#emSt', { email: { host: val('#emHost'), port: port ? +port : undefined, secure: $<HTMLInputElement>('#emSecure').checked, user: val('#emUser'), from: val('#emFrom'), to: val('#emTo'), ...(password ? { password } : {}) } });
}
async function test(channel: string) {
  const st = channel === 'telegram' ? '#tgSt' : channel === 'email' ? '#emSt' : '#whSt';
  const saved = channel === 'telegram' ? await saveTelegram() : channel === 'email' ? await saveEmail() : await saveSection(st, { webhook: { url: val('#whUrl') } });
  if (!saved) return;
  status(st, 'Sending test…');
  try { const d = await api<Delivery>('/api/notify/test', { body: { channel } }); status(st, d.ok ? 'Test sent ✓' : `Failed: ${d.error ?? 'unknown error'}`, d.ok) }
  catch (e) { status(st, errMsg(e), false) }
}
async function pickChat() {
  if (!ns?.telegram?.hasToken && !val('#tgToken')) return status('#tgSt', 'Save the bot token first', false);
  if (val('#tgToken') && !(await saveTelegram())) return;
  status('#tgSt', 'Looking for chats…');
  try {
    const r = await api<unknown>('/api/notify/telegram/chats');
    const chats = (Array.isArray(r) ? r : ((r as { chats?: unknown[] }).chats ?? [])) as Record<string, unknown>[];
    if (!chats.length) { status('#tgSt', 'No chats yet — send a message to your bot, then try again', false); return }
    status('#tgSt', 'Choose your chat:');
    $('#tgChats').innerHTML = chats.map(c => {
      const id = String(c.id ?? c.chatId ?? ''), name = String(c.title || c.username || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || '');
      return `<button type="button" class="chip-btn" data-chat="${esc(id)}">${esc(name || id)} <span class="muted">${esc(id)}${c.type ? ' · ' + esc(c.type) : ''}</span></button>`;
    }).join('');
  } catch (e) { status('#tgSt', errMsg(e), false) }
}

// ---------- push + desktop notifications ----------
const PUSH_TEXT: Record<PushState, string> = {
  unsupported: 'Not supported in this browser (on iPhone: open the app from the Home Screen)',
  insecure: 'Needs HTTPS — open the app through a home-network https:// address', denied: 'Blocked in the browser’s site settings',
  off: 'Off on this device', on: 'On for this device',
};
async function renderPush() {
  let s: PushState;
  try { s = await pushState() } catch { s = 'unsupported' }
  status('#pushSt', PUSH_TEXT[s], s === 'on' ? true : s === 'off' ? undefined : false);
  const b = $<HTMLButtonElement>('#pushBtn');
  b.hidden = s !== 'on' && s !== 'off'; b.textContent = s === 'on' ? 'Turn off' : 'Turn on'; b.dataset.on = s === 'on' ? '1' : '';
}
async function togglePush() {
  const b = $<HTMLButtonElement>('#pushBtn'); b.disabled = true;
  try { if (b.dataset.on) await disablePush(); else await enablePush() } catch (e) { status('#pushSt', errMsg(e), false); b.disabled = false; return }
  b.disabled = false; renderPush();
}
function renderNotif() {
  const p = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  $('#notifSt').textContent = p === 'granted' ? 'Allowed — shown when the app is in the background' : p === 'denied' ? 'Blocked in the browser’s site settings' : p === 'default' ? 'Not allowed yet' : 'Not supported here';
  $('#notifBtn').hidden = p !== 'default';
}

// ---------- trade recording ----------
const day = (t?: number) => (t ? new Date(t < 1e12 ? t * 1000 : t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');
async function loadRecorder() {
  let r: Recorder;
  try { r = await api<Recorder>('/api/recorder') } catch (e) { status('#recSt', errMsg(e), false); return }
  $<HTMLInputElement>('#recSyms').value = (r.symbols ?? []).join(', ');
  $('#recDays').textContent = String(r.retentionDays ?? 30);
  const stats = r.stats ?? [], total = stats.reduce((a, s) => a + (s.approxBytes || 0), 0);
  $('#recT').innerHTML = '<tr><th>Symbol</th><th>From</th><th>To</th><th>Trades</th><th>Size</th></tr>' + (stats.map(s =>
    `<tr><td>${esc(s.sym)}</td><td>${esc(day(s.from))}</td><td>${esc(day(s.to))}</td><td>${esc(s.count >= 1000 ? fmtVol(s.count) : String(s.count || 0))}</td><td>≈ ${esc(bytes(s.approxBytes))}</td></tr>`).join('') || '<tr><td class="muted" colspan="5">Nothing recorded yet</td></tr>')
    + (stats.length > 1 ? `<tr><td colspan="4" class="muted">Total</td><td>≈ ${esc(bytes(total))}</td></tr>` : '');
}
const bytes = (n = 0) => (n >= 1 << 30 ? (n / (1 << 30)).toFixed(1) + ' GB' : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB');
async function saveRecorder() {
  const symbols = [...new Set(val('#recSyms').toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  const bad = symbols.find(s => !/^([A-Z0-9]+:)?[A-Z0-9_.]{2,40}$/.test(s));
  if (bad) return status('#recSt', `Not a valid symbol: ${bad}`, false);
  status('#recSt', 'Saving…');
  try { await api('/api/recorder', { method: 'PUT', body: { symbols } }); status('#recSt', 'Saved', true); loadRecorder() } catch (e) { status('#recSt', errMsg(e), false) }
}

// ---------- home network ----------
async function loadLan() {
  let l: Lan;
  try { l = await api<Lan>('/api/lan') } catch (e) { status('#lanSt', errMsg(e), false); return }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const on = $<HTMLInputElement>('#lanOn'); on.checked = !!l.enabled; on.disabled = !local;
  $('#lanNote').textContent = local ? `port ${l.port}` : 'Can only be changed on the server PC';
  $('#lanUrls').innerHTML = l.enabled && l.urls?.length ? l.urls.map(u => /^https?:\/\//.test(u) ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u)).join('<br>') : '<span class="muted">Off</span>';
  $('#lanFp').textContent = l.caFingerprint ?? '—';
}
