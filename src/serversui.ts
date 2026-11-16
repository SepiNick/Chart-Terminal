// Settings → Servers: saved servers, the sync server, the optional trading server, and the feature gates
// (elements marked data-feature="trading|ai|ml|forward|scripts" are hidden when the matching server does not offer them).
import { SHOW_AI } from './flags.ts';
import { dialog, injectStyle } from './login.ts';
import { esc, toast } from './store.ts';
import { bundledOrigin, leaveStandalone, watchForServer } from './standalone.ts';
import { STANDALONE_WHY, addServer, isStandalone, canBeTradeServer, gate, listServers, markSaved, mixedContentWarning, normalizeBaseUrl, onServersChanged, parseDiscovered, probeStatus, recordStatus, removeServer, setSyncServer, setTradeServer, syncServer, tradeId, tradeServer, updateServer, type Features, type Found, type ServerStatus } from './servers.ts';
import { lastSyncAt, onSyncStatus } from './sync.ts';
import { connectPaired, nativeBridge } from './pairui.ts';
import { parsePair, serializePair } from './pairing.ts';

const FEATS = (['trading', 'ai', 'ml', 'forward', 'scripts', 'python'] as (keyof Features)[]).filter(f => SHOW_AI || (f !== 'ai' && f !== 'ml'));
const feats = (f?: Features) => (f ? FEATS.filter(k => f[k]).join(', ') || 'none' : 'unknown');

export function openServers() {
  dialog('Servers', '<div data-sync class="muted"></div><div data-local></div><div data-list></div><div data-saved hidden></div><div data-found hidden></div><hr><div class="form"><label>Pairing code</label><input name="pcode" placeholder="Code or chartterminal:// link from Pair a phone" autocomplete="off" spellcheck="false"><label>Server address</label><input name="paddr" placeholder="Only needed when you type the code by hand" autocomplete="off" spellcheck="false"></div><div class="row"><button type="button" data-scan>Scan QR</button><button type="button" data-pair>Pair</button></div><div class="ct-err" data-perr></div><hr><div class="form"><label>Add server</label><input name="url" placeholder="https://my-server.example or 192.168.1.5:8787" autocomplete="off" spellcheck="false"></div><div data-probe class="muted"></div><div class="ct-err" data-err></div><div class="row"><button type="button" data-check>Check</button><span class="grow"></span><button type="button" data-add disabled>Add</button><button type="button" data-x class="on">Close</button></div>', (f, close) => {
    const list = f.querySelector<HTMLElement>('[data-list]')!, probe = f.querySelector<HTMLElement>('[data-probe]')!, err = f.querySelector<HTMLElement>('[data-err]')!;
    const url = f.elements.namedItem('url') as HTMLInputElement, add = f.querySelector<HTMLButtonElement>('[data-add]')!;
    let found: { base: string; st: ServerStatus } | null = null;
    const render = () => {
      const tid = tradeId(), eligible = listServers().filter(s => canBeTradeServer(s).ok);
      list.innerHTML = `<table><tr><th>Server</th><th>Kind</th><th>Offers</th><th></th></tr>${listServers().map(s => {
        const w = mixedContentWarning(s);
        return `<tr><td>${esc(s.serverName ?? s.name)}${s.id === syncServer().id ? ' <b>(sync)</b>' : ''}${s.id === tradeServer()?.id ? ' <b>(trading)</b>' : ''}<br><span class="muted">${esc(s.baseUrl || 'this server (opened from)')}</span>${w ? `<br><span class="ct-warn">${esc(w)}</span>` : ''}</td>
          <td>${esc(s.mode ?? 'unknown')}</td><td class="muted">${esc(feats(s.features))}</td>
          <td style="white-space:nowrap">${s.id === syncServer().id ? '' : `<button type="button" data-use="${esc(s.id)}">Use for sync</button> `}${s.id !== 'local' ? `<button type="button" data-ed="${esc(s.id)}">Edit</button> <button type="button" data-rm="${esc(s.id)}">Remove</button>` : ''}</td></tr>`;
      }).join('')}</table>
      <div class="form"><label>Trading server</label><select name="trade"><option value="">Automatic (the sync server when it is private)</option>${eligible.map(s => `<option value="${esc(s.id)}"${s.id === tid ? ' selected' : ''}>${esc(s.serverName ?? s.name)}</option>`).join('')}</select></div>
      ${isStandalone() ? `<p class="muted ct-warn">${STANDALONE_WHY}. Add a server below and press "Use for sync" to connect; until then everything stays on this device.</p>` : FEATS.filter(k => !gate(k).on).slice(0, 1).map(k => `<p class="muted ct-warn">${esc(gate(k).why)}</p>`).join('')}`;
      list.querySelector<HTMLSelectElement>('[name=trade]')!.onchange = e => { try { setTradeServer((e.target as HTMLSelectElement).value || null); toast('Trading server changed — reload to apply'); render() } catch (x) { err.textContent = (x as Error).message } };
    };
    list.onclick = async e => {
      const el = e.target as HTMLElement, use = el.dataset.use, rm = el.dataset.rm;
      const ed = el.dataset.ed, nat = nativeBridge(), usv = listServers().find(x => x.id === use);
      if (usv && nat?.openServer && usv.baseUrl) { try { callNative(nat.openServer(usv.baseUrl, usv.serverName ?? usv.name)) } catch (x) { err.textContent = (x as Error).message } return }
      if (use && confirm('Switch the sync server? The page reloads and asks you to sign in there.')) { setSyncServer(use); location.reload() }
      if (ed) {
        const sv = listServers().find(x => x.id === ed); if (!sv) return;
        const name = prompt('Name', sv.serverName ?? sv.name); if (name === null) return;
        const addr = prompt('Address', sv.baseUrl); if (addr === null) return;
        try { const moved = addr.trim() !== sv.baseUrl; updateServer(ed, { name, baseUrl: addr }); if (moved && syncServer().id === ed) location.reload(); else render() } catch (x) { err.textContent = (x as Error).message }
      }
      if (rm && confirm('Remove this server from this device? (Your account on it is not deleted.)')) {
        const was = syncServer().id === rm; removeServer(rm); if (was) location.reload(); else render();
      }
    };
    f.querySelector<HTMLButtonElement>('[data-check]')!.onclick = async () => {
      err.textContent = ''; probe.textContent = ''; found = null; add.disabled = true;
      let base: string; try { base = normalizeBaseUrl(url.value) } catch (x) { err.textContent = (x as Error).message; return }
      probe.textContent = 'Checking…';
      const st = await probeStatus(base);
      if (!st) { probe.textContent = ''; err.textContent = 'No Chart Terminal server answered there (or it does not allow this site to connect).'; return }
      found = { base, st };
      const w = mixedContentWarning({ baseUrl: base });
      probe.innerHTML = `${esc(st.serverName ?? base)} — <b>${st.mode}</b> server${st.mode === 'public' ? `, sign-up: ${st.registration}` : ''}. Offers: ${esc(feats(st.features))}.${w ? `<br><span class="ct-warn">${esc(w)}</span>` : ''}`;
      add.disabled = false;
    };
    add.onclick = () => {
      if (!found) return;
      const s = addServer(found.base, found.st.serverName); recordStatus(s.id, found.st);
      found = null; url.value = ''; probe.textContent = ''; add.disabled = true; render();
    };
    f.querySelector<HTMLButtonElement>('[data-x]')!.onclick = close;
    f.onsubmit = e => e.preventDefault();
    wireExtras(f);
    render();
  });
}

/** Hide what the connected servers do not offer, with the reason as a tooltip and one notice. Re-runs when servers change. */
export function applyGates() {
  const run = () => {
    document.querySelectorAll<HTMLElement>('[data-feature]').forEach(el => {
      const g = gate(el.dataset.feature as keyof Features);
      el.hidden = !g.on; el.title = g.on ? el.title : g.why;
    });
    document.querySelectorAll<HTMLElement>('[data-needs-server]').forEach(el => { el.hidden = isStandalone(); el.title = isStandalone() ? STANDALONE_WHY : el.title });
    // an open side panel whose rail button just disappeared would leave an empty panel
    const open = document.querySelector<HTMLElement>('#rail [data-side].on');
    if (open?.hidden) document.querySelector<HTMLElement>('#rail [data-side="watch"]')?.click();
    const why = FEATS.map(k => gate(k)).find(g => !g.on);
    let n = document.getElementById('gateNote');
    if (why && syncServer().mode === 'public') {
      if (!n) {
        n = document.createElement('div'); n.id = 'gateNote'; n.className = 'ct-banner'; n.style.left = '56px';
        n.innerHTML = '<span></span><button title="Servers">Why?</button><button title="Hide">✕</button>';
        const [why, close] = n.querySelectorAll('button');
        why.onclick = () => { openServers() }; close.onclick = () => { n!.remove(); try { sessionStorage.setItem('ctGateNote', '1') } catch {} };
        let hidden = false; try { hidden = !!sessionStorage.getItem('ctGateNote') } catch {}
        if (!hidden) document.body.append(n);
      }
      n.firstElementChild!.textContent = why.why;
    } else n?.remove();
  };
  run(); onServersChanged(run);
}

/** Standalone chip: says where the data lives, offers the server picker, and turns into a "switch" prompt if a server appears. */
export function standaloneChip() {
  injectStyle();
  const d = document.createElement('div'); d.className = 'ct-banner'; d.id = 'standaloneChip';
  d.innerHTML = '<span data-t>Standalone · data stays on this device</span><button data-s title="Pick or add a Chart Terminal server">Connect to a server</button>';
  // the bundled Android app only talks to Binance, so a server needs the client app instead
  if (bundledOrigin()) d.querySelector('[data-t]')!.textContent = 'Local mode · this device only · Binance only';
  d.querySelector<HTMLElement>('[data-s]')!.onclick = openServers;
  document.body.append(d);
  watchForServer(() => {
    d.querySelector('[data-t]')!.textContent = 'A server is reachable now';
    const b = d.querySelector<HTMLElement>('[data-s]')!;
    b.textContent = 'Switch'; b.onclick = () => { leaveStandalone(); location.reload() };
  });
}

// ---------- network discovery, pairing, local mode, sync status (added to the Servers dialog) ----------
/** CTNative methods answer with plain values or a JSON text; `{ok:false,error}` / `false` mean the app refused. */
function callNative(r: unknown) {
  let v = r; if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return } }
  if (v === false) throw Error('The app did not accept this address');
  const o = v as { ok?: boolean; error?: string } | null;
  if (o && typeof o === 'object' && (o.ok === false || o.error)) throw Error(o.error || 'The app did not accept this address');
}
const ctDiscover = () => (globalThis as { ctDiscover?: () => unknown }).ctDiscover;
const nativeSaved = (): { url: string; name: string }[] => {
  let v: unknown; try { v = nativeBridge()?.servers?.(); if (typeof v === 'string') v = JSON.parse(v) } catch { return [] }
  return Array.isArray(v) ? v.filter((x): x is { url: string; name?: string } => !!x && typeof (x as { url?: unknown }).url === 'string').map(x => ({ url: x.url, name: String(x.name ?? x.url).slice(0, 60) })) : [];
};

/** Repaint only when the markup changed, so a poll never swallows a click. */
const set = (el: HTMLElement, html: string) => { if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html } };

function wireExtras(f: HTMLFormElement) {
  const nat = nativeBridge(), bundled = bundledOrigin(), disc = ctDiscover();
  const q = <T extends HTMLElement>(s: string) => f.querySelector<T>(s)!;
  const perr = q('[data-perr]'), local = q('[data-local]'), saved = q('[data-saved]'), foundEl = q('[data-found]'), line = q('[data-sync]');
  let heard: Found[] = [];
  if (nat && bundled) q('[data-list]').hidden = true;   // local mode: the phone's own list below replaces the page's list

  // where the data lives, and when it last synced
  const paint = () => {
    const sv = syncServer();
    line.textContent = isStandalone()
      ? (bundled ? 'Local mode: everything stays on this device. Connect to a server to sync and to use every exchange and broker.' : 'Not connected to a server.')
      : `Synced with ${sv.serverName ?? sv.name}${lastSyncAt() ? ` · last sync ${new Date(lastSyncAt()).toLocaleTimeString()}` : ''}`;
  };
  const offStatus = onSyncStatus(paint);

  // Android: local mode switch + the honest note
  if (nat?.openLocal || nat?.openServer) {
    local.innerHTML = `<p class="muted ct-warn">Local mode (no server) has Binance only. A server gives every exchange and broker: a PC running Chart Terminal with Home network access, a Raspberry Pi, or a VPS.</p>${nat.openLocal && !bundled ? '<div class="row"><button type="button" data-local>Use this device only (local mode)</button></div>' : ''}`;
    local.onclick = e => { if ((e.target as HTMLElement).dataset.local !== undefined && confirm('Switch to local mode? You will only have Binance, and the app leaves the server.')) callNative(nat.openLocal!()) };
  }

  // connect to an address (heard on the network, saved on the phone, or scanned)
  const connect = async (url: string, name: string) => {
    perr.textContent = '';
    try {
      if (nat?.openServer) return callNative(nat.openServer(url, name));
      const st = await probeStatus(url);
      if (!st) throw Error('No Chart Terminal server answered there. Check the Wi-Fi, the PC firewall (docs/lan-setup.md) and any VPN.');
      if (!confirm(`Use ${st.serverName ?? name} as your server? The page reloads and asks you to sign in there.`)) return;
      const s = addServer(url, st.serverName ?? name); recordStatus(s.id, st); setSyncServer(s.id); location.reload();
    } catch (x) { perr.textContent = (x as Error).message }
  };
  const btns = (urls: string[], name: string) => urls.map((u, i) => `<button type="button" data-c="${esc(u)}" data-n="${esc(name)}"${i ? ' class="muted"' : ''}>${i ? esc(u) : 'Connect'}</button>`).join(' ');

  // saved on the phone (CTNative.servers)
  const paintSaved = () => {
    const list = nativeSaved(); saved.hidden = !list.length;
    set(saved, list.length ? `<b>Saved on this phone</b><table>${list.map(s => `<tr><td>${esc(s.name)}<br><span class="muted">${esc(s.url)}</span></td><td style="white-space:nowrap">${btns([s.url], s.name)} <button type="button" data-forget="${esc(s.url)}">Forget</button></td></tr>`).join('')}</table>` : '');
  };
  saved.onclick = e => { const el = e.target as HTMLElement; if (el.dataset.c) void connect(el.dataset.c, el.dataset.n ?? ''); if (el.dataset.forget && confirm('Forget this server on this phone?')) { try { nat?.forget?.(el.dataset.forget) } catch { /* ignore */ } paintSaved() } };

  // servers heard on this network (poll every 3 s while the page is open)
  const canFind = !!(nat?.discover || disc);
  foundEl.hidden = !canFind;
  foundEl.onclick = e => { const el = e.target as HTMLElement; if (el.dataset.c) void connect(el.dataset.c, el.dataset.n ?? '') };
  const paintFound = () => {
    const known = [...listServers(), ...nativeSaved().map(s => ({ baseUrl: s.url }))];
    heard = markSaved(heard, known);
    set(foundEl, `<b>Servers on this network</b>${heard.length ? `<table>${heard.map(h => `<tr><td>${esc(h.name)}${h.mode === 'public' ? ' <span class="muted">(team)</span>' : ''}${h.twofa ? ' <span class="muted" title="Asks for a two-step code">🔐 2FA</span>' : ''}${h.saved ? ' <span class="muted">(saved)</span>' : ''}<br><span class="muted">${esc(h.urls[0])}${h.version ? ` · v${esc(h.version)}` : ''}</span></td><td style="white-space:nowrap">${btns(h.urls, h.name)}</td></tr>`).join('')}</table>` : '<div class="muted">Looking… Only servers on the same Wi-Fi network (subnet) are found, and not on guest networks that isolate devices. Turn on Home network access in the PC app.</div>'}`);
  };
  const poll = async () => {
    if (!canFind) return;
    try { heard = parseDiscovered(await Promise.resolve(nat?.discover ? nat.discover() : disc!())) } catch { heard = [] }
    paintFound();
  };

  // pairing: scan a QR or type the code
  const code = f.elements.namedItem('pcode') as HTMLInputElement, addr = f.elements.namedItem('paddr') as HTMLInputElement;
  const pair = async (text: string) => {
    perr.textContent = '';
    try {
      const p = parsePair(text);
      let extra: string[] = [];
      if (!p.urls.length) {
        if (addr.value.trim()) extra = [normalizeBaseUrl(addr.value)];
        else if (heard.length === 1) extra = heard[0].urls;
        else throw Error('Enter the server address too (it is on the pairing screen), or scan the QR code.');
      }
      await connectPaired(p, extra);
    } catch (x) { perr.textContent = (x as Error).message }
  };
  q('[data-pair]').onclick = () => void pair(code.value);
  q('[data-scan]').onclick = async () => {
    perr.textContent = '';
    const r = await (await import('./qrscan.ts')).scanQr();
    if (r?.kind === 'pair') await pair(serializePair(r.pair));
    else if (r?.kind === 'server') void connect(r.url, '');
  };

  paint(); paintSaved(); void poll();
  const t = window.setInterval(() => {
    if (!f.isConnected) { clearInterval(t); offStatus(); return }
    paint(); paintSaved(); void poll();
  }, 3000);
}
