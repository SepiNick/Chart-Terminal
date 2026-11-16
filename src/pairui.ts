// "Pair a phone": the QR code + manual code of this server (account menu / tray) with a countdown and the paired devices,
// and the other half: redeeming a scanned or typed code and connecting (Servers page). HTTP: twofaapi.ts, parsing: pairing.ts.
import { dialog } from './login.ts';
import { api } from './sync.ts';
import { esc, toast } from './store.ts';
import { addServer, deviceLabel, isSameOrigin, isStandalone, probeStatus, recordStatus, setSyncServer, setToken } from './servers.ts';
import { countdown, expiresAtMs, firstReachable, redeemFirst, showCode, type PairInfo } from './pairing.ts';
import { pairRedeem, pairStart, svgSrc, type PairStart } from './twofaapi.ts';

export interface NativeBridge { discover?(): unknown; openServer?(url: string, name: string): unknown; openLocal?(): unknown; probe?(url: string): boolean; servers?(): unknown; forget?(url: string): unknown; nativeVersion?(): unknown }
/** Android's JS bridge (window.CTNative), when this page runs inside the app. Never assumed. */
export const nativeBridge = (): NativeBridge | undefined => (globalThis as { CTNative?: NativeBridge }).CTNative;

/** Same-origin redeem (a server opened by the Android app with `#pair=<code>`): the session cookie is set for this page. */
export async function redeemHere(code: string): Promise<void> {
  await pairRedeem(location.origin, code, false, '');
  location.reload();
}

/** Redeem a scanned / typed code and make that server this device's server. `extraUrls` are tried when the code carries no address. */
export async function connectPaired(p: PairInfo, extraUrls: string[] = []): Promise<void> {
  const urls = p.urls.length ? p.urls : extraUrls;
  const nat = nativeBridge();
  if (urls.length && !confirm(`Connect to ${p.name || 'this server'} at ${new URL(urls[0]).host}?`)) return;   // never switch servers blind (a QR in the wild can name any address)
  // Android: the app opens the server itself and the page there redeems the code (a cookie session, as the app needs)
  if (nat?.openServer && urls.length) {
    const first = await firstReachable(urls, u => { try { return !!nat.probe?.(u) } catch { return false } });   // a QR lists every interface: skip addresses this phone cannot reach
    if (!first) throw Error('Could not reach the server at any address in this code. Is the phone on the same Wi-Fi, and is the PC firewall or VPN blocking it?');
    nat.openServer(`${first}/#pair=${p.code}`, p.name); return;
  }
  const { base, result } = await redeemFirst(urls, b => pairRedeem(b, p.code, !isSameOrigin({ baseUrl: b }), deviceLabel()));
  if (isSameOrigin({ baseUrl: base })) return location.reload();
  if (!result.token) throw Error('The server did not return a sign-in for this device');
  const s = addServer(base, p.name); setToken(s.id, result.token);
  const st = await probeStatus(base); if (st) recordStatus(s.id, st);
  setSyncServer(s.id); location.reload();
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
type Dev = { id: string; label?: string; agent?: string | null; created: number; lastUsed?: number; last_seen?: number; current?: boolean };

export function openPair() {
  if (isStandalone()) return toast('Pairing needs a server: connect to one first (Servers…).', 5000);
  dialog('Pair a phone', `<div data-body class="muted">Making a code…</div>
    <div class="ct-err" data-err></div>
    <hr><b>Paired devices</b><div data-devs class="muted">Loading…</div>
    <p class="muted">The phone must reach this server: same Wi-Fi network, and no VPN or firewall in between (see docs/pairing.md). Each code works once and expires after 5 minutes. Paired devices stay signed in until you sign them out here.</p>
    <div class="row"><span class="grow"></span><button type="button" data-x class="on">Close</button></div>`, (f, close) => {
    const body = f.querySelector<HTMLElement>('[data-body]')!, err = f.querySelector<HTMLElement>('[data-err]')!, devs = f.querySelector<HTMLElement>('[data-devs]')!;
    let cur: PairStart | null = null, until = 0, known: Set<string> | null = null;
    const alive = () => f.isConnected;
    const draw = () => {
      if (!cur) return;
      body.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
        ${cur.qrSvg ? `<img alt="Pairing QR code" src="${esc(svgSrc(cur.qrSvg))}" style="width:200px;height:200px;background:#fff;padding:6px;border-radius:6px">` : ''}
        <div><div class="muted">On the phone: Chart Terminal → Servers → <b>Scan QR</b></div>
          <div class="muted" style="margin-top:8px">Or type this code:</div>
          <div style="font:600 24px/1.4 ui-monospace,monospace;letter-spacing:2px;user-select:all">${esc(showCode(cur.code))}</div>
          <div data-left class="muted"></div>
          <div class="row" style="margin-top:6px"><button type="button" data-new>New code</button><button type="button" data-copy>Copy link</button></div></div></div>`;
      body.querySelector<HTMLElement>('[data-new]')!.onclick = fresh;
      body.querySelector<HTMLElement>('[data-copy]')!.onclick = () => { navigator.clipboard.writeText(cur!.payload).then(() => toast('Pairing link copied'), () => prompt('Pairing link', cur!.payload)) };
      tick();
    };
    const tick = () => {
      const left = body.querySelector<HTMLElement>('[data-left]'); if (!left) return;
      const ms = until - Date.now();
      left.textContent = ms > 0 ? `Expires in ${countdown(ms)}` : 'Expired: press New code';
      const img = body.querySelector('img'); if (img) img.style.opacity = ms > 0 ? '' : '.2';
    };
    async function fresh() {
      err.textContent = '';
      try { cur = await pairStart(); until = expiresAtMs(cur.expires); draw() } catch (e) { err.textContent = (e as Error).message }
    }
    const loadDevs = async () => {
      try {
        const list = await api<Dev[]>('/api/auth/devices');
        if (known) for (const d of list) if (!known.has(d.id)) toast(`Paired: ${d.label || d.agent?.slice(0, 40) || 'new device'}`, 5000);
        known = new Set(list.map(d => d.id));
        devs.innerHTML = list.length ? `<table>${list.map(d => `<tr><td>${esc(d.label || d.agent?.slice(0, 40) || 'Device')}${d.current ? ' <span class="muted">(this device)</span>' : ''}</td><td class="muted">${esc(when(d.last_seen ?? d.lastUsed ?? d.created))}</td><td>${d.current ? '' : `<button type="button" data-end="${esc(d.id)}">Sign out</button>`}</td></tr>`).join('')}</table>` : '<span class="muted">None yet.</span>';
      } catch (e) { devs.textContent = (e as Error).message }
    };
    devs.onclick = async e => {
      const id = (e.target as HTMLElement).dataset.end; if (!id) return;
      try { await api(`/api/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }); known?.delete(id); toast('Device signed out'); void loadDevs() } catch (x) { toast((x as Error).message) }
    };
    f.querySelector<HTMLElement>('[data-x]')!.onclick = close;
    f.onsubmit = e => { e.preventDefault() };
    void fresh(); void loadDevs();
    const t = window.setInterval(() => { if (!alive()) return clearInterval(t); tick() }, 1000);
    const p = window.setInterval(() => { if (!alive()) return clearInterval(p); void loadDevs() }, 4000);
  });
}
