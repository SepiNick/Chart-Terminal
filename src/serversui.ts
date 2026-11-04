// Settings → Servers: saved servers, the sync server, the optional trading server, and the feature gates
// (elements marked data-feature="trading|ai|ml|forward|scripts" are hidden when the matching server does not offer them).
import { dialog } from './login.ts';
import { esc, toast } from './store.ts';
import { addServer, canBeTradeServer, gate, listServers, mixedContentWarning, normalizeBaseUrl, onServersChanged, probeStatus, recordStatus, removeServer, setSyncServer, setTradeServer, syncServer, tradeId, tradeServer, type Features, type ServerStatus } from './servers.ts';

const FEATS: (keyof Features)[] = ['trading', 'ai', 'ml', 'forward', 'scripts'];
const feats = (f?: Features) => (f ? FEATS.filter(k => f[k]).join(', ') || 'none' : 'unknown');

export function openServers() {
  dialog('Servers', '<div data-list></div><hr><div class="form"><label>Add server</label><input name="url" placeholder="https://my-server.example or 192.168.1.5:8787" autocomplete="off" spellcheck="false"></div><div data-probe class="muted"></div><div class="ct-err" data-err></div><div class="row"><button type="button" data-check>Check</button><span class="grow"></span><button type="button" data-add disabled>Add</button><button type="button" data-x class="on">Close</button></div>', (f, close) => {
    const list = f.querySelector<HTMLElement>('[data-list]')!, probe = f.querySelector<HTMLElement>('[data-probe]')!, err = f.querySelector<HTMLElement>('[data-err]')!;
    const url = f.elements.namedItem('url') as HTMLInputElement, add = f.querySelector<HTMLButtonElement>('[data-add]')!;
    let found: { base: string; st: ServerStatus } | null = null;
    const render = () => {
      const tid = tradeId(), eligible = listServers().filter(s => canBeTradeServer(s).ok);
      list.innerHTML = `<table><tr><th>Server</th><th>Kind</th><th>Offers</th><th></th></tr>${listServers().map(s => {
        const w = mixedContentWarning(s);
        return `<tr><td>${esc(s.serverName ?? s.name)}${s.id === syncServer().id ? ' <b>(sync)</b>' : ''}${s.id === tradeServer()?.id ? ' <b>(trading)</b>' : ''}<br><span class="muted">${esc(s.baseUrl || 'this server (opened from)')}</span>${w ? `<br><span class="ct-warn">${esc(w)}</span>` : ''}</td>
          <td>${esc(s.mode ?? 'unknown')}</td><td class="muted">${esc(feats(s.features))}</td>
          <td style="white-space:nowrap">${s.id === syncServer().id ? '' : `<button type="button" data-use="${esc(s.id)}">Use for sync</button> `}${s.id !== 'local' ? `<button type="button" data-rm="${esc(s.id)}">Remove</button>` : ''}</td></tr>`;
      }).join('')}</table>
      <div class="form"><label>Trading server</label><select name="trade"><option value="">Automatic (the sync server when it is private)</option>${eligible.map(s => `<option value="${esc(s.id)}"${s.id === tid ? ' selected' : ''}>${esc(s.serverName ?? s.name)}</option>`).join('')}</select></div>
      ${FEATS.filter(k => !gate(k).on).slice(0, 1).map(k => `<p class="muted ct-warn">${esc(gate(k).why)}</p>`).join('')}`;
      list.querySelector<HTMLSelectElement>('[name=trade]')!.onchange = e => { try { setTradeServer((e.target as HTMLSelectElement).value || null); toast('Trading server changed — reload to apply'); render() } catch (x) { err.textContent = (x as Error).message } };
    };
    list.onclick = async e => {
      const el = e.target as HTMLElement, use = el.dataset.use, rm = el.dataset.rm;
      if (use && confirm('Switch the sync server? The page reloads and asks you to sign in there.')) { setSyncServer(use); location.reload() }
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

/** Offline banner: what is wrong, retry, and a way to pick another server. */
export function offlineBanner(name: string) {
  const d = document.createElement('div'); d.className = 'ct-banner';
  d.innerHTML = `Cannot reach ${esc(name)} — showing the data saved on this device. <button data-r>Retry</button><button data-s>Servers…</button><button data-x title="Hide">✕</button>`;
  d.querySelector<HTMLElement>('[data-r]')!.onclick = () => location.reload();
  d.querySelector<HTMLElement>('[data-s]')!.onclick = openServers;
  d.querySelector<HTMLElement>('[data-x]')!.onclick = () => d.remove();
  document.body.append(d);
}
