// Chart Terminal desktop shell: starts the bundled server on a free 127.0.0.1 port with the data in the user's app-data
// folder, then shows the app in a window from that server (same origin, so login cookies, /api and /ws work as usual).
const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, screen, shell, utilityProcess, session } = require('electron');
const { createServer } = require('node:net');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// CT_USER_DATA: a separate data folder for testing, so a test login never lands in the real app's data.
if (process.env.CT_USER_DATA) app.setPath('userData', process.env.CT_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();   // two servers must never share one database

const APP = join(__dirname, 'app');
let server = null, win = null, origin = '', tray = null;   // win: the main window (more come from "New window")
app.setAppUserModelId('app.chartterminal.desktop');   // Windows shows the app's notifications under its own name

// Settings of the shell itself (not of the app, which keeps its own on the server).
const settingsFile = () => join(app.getPath('userData'), 'desktop.json');
const settings = () => { try { return { tray: true, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) } } catch { return { tray: true } } };
const saveSettings = s => { try { writeFileSync(settingsFile(), JSON.stringify(s)) } catch {} };

/** A free loopback port: `want` if it is free, else any (the dev server or the user's own server may hold 8787). */
const freePort = want => new Promise((ok, fail) => {
  const s = createServer().once('error', () => (want ? freePort(0).then(ok, fail) : fail(Error('No free port'))))
    .listen(want, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) });
});
// The same port every launch keeps the same origin, so the browser storage the app keeps per origin (local settings) stays.
const portFile = () => join(app.getPath('userData'), 'port.txt');

async function startServer() {
  let saved = 0;
  try { saved = Number(readFileSync(portFile(), 'utf8')) || 0 } catch {}
  const port = await freePort(saved);
  if (port !== saved) try { writeFileSync(portFile(), String(port)) } catch {}
  origin = `http://127.0.0.1:${port}`;
  console.log(`Chart Terminal: ${origin}, data in ${app.getPath('userData')}`);
  server = utilityProcess.fork(join(APP, 'server', 'index.js'), [], {
    serviceName: 'Chart Terminal server', stdio: 'pipe',
    env: { ...process.env, PORT: String(port), CT_DATA_DIR: join(app.getPath('userData'), 'data'), CT_DIST_DIR: join(APP, 'dist') },
  });
  const log = [];
  for (const s of [server.stdout, server.stderr]) s?.on('data', d => { log.push(String(d)); if (log.length > 50) log.shift() });
  server.once('exit', code => {
    if (quitting) return;
    dialog.showErrorBox('Chart Terminal', `The server stopped (code ${code}).\n\n${log.join('').slice(-1500)}`);
    app.quit();
  });
  // Ready once it answers: the window then loads with the session cookie flow working from the first request.
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`${origin}/api/auth/status`)).ok) return } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`The server did not start.\n\n${log.join('').slice(-1500)}`);
}

function createWindow(main = true, o = {}) {
  const w = new BrowserWindow({
    width: 1440, height: 900, ...(o.bounds ?? {}), minWidth: o.bounds ? 360 : 900, minHeight: o.bounds ? 260 : 600, show: false, backgroundColor: '#131722',
    title: 'Chart Terminal', icon: join(__dirname, 'build', 'icon.png'),
    // The page only talks HTTP to its own server; the preload only adds window.prompt(). It keeps running when the
    // window is hidden in the tray (live prices, alert notifications), so it is not throttled in the background.
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(__dirname, 'preload.cjs'), backgroundThrottling: false, devTools: !app.isPackaged },
  });
  if (main) {
    win = w;
    // Closing the main window hides it in the tray: the server keeps running (alerts, forward tests, recording).
    w.on('close', e => {
      if (quitting) return;
      // Pop-out windows are open: keep them, bring them back into this window, or close them (or cancel).
      if (popWins.size && !popAsked) {
        e.preventDefault(); popAsked = true;
        dialog.showMessageBox(w, { type: 'question', buttons: ['Keep them open', 'Bring them back', 'Close them', 'Cancel'], defaultId: 0, cancelId: 3, title: 'Chart Terminal',
          message: `${popWins.size} pop-out window${popWins.size > 1 ? 's are' : ' is'} still open.`, detail: 'Keep them open: they stay on their screens. Bring them back: their panels return to the main window. Close them: they are closed (Monitors > Restore all windows opens them again).' })
          .then(async ({ response }) => {
            if (response === 3) { popAsked = false; return }
            if (response === 1) { await w.webContents.executeJavaScript('window.__ctDock && window.__ctDock()').catch(() => {}); await new Promise(r => setTimeout(r, 400)) }
            if (response === 2) for (const p of [...popWins.values()]) p.close();
            if (!w.isDestroyed()) w.close();
          }, () => { popAsked = false });
        return;
      }
      popAsked = false;
      if (!settings().tray || !tray) return;
      e.preventDefault(); w.hide();
      if (!settings().trayTold) { saveSettings({ ...settings(), trayTold: true }); notify('Chart Terminal is still running', 'Alerts and forward tests keep working. Quit from the tray icon.') }
    });
    w.on('closed', () => { if (win === w) win = null });
    trackDisplay(w, 'main');
    // Windows shutdown / sign-out: really close (no hiding), and let before-quit stop the server cleanly.
    w.on('query-session-end', () => { quitting = true });
    w.on('session-end', () => { quitting = true; app.quit() });
  }
  w.once('ready-to-show', () => w.show());
  // Stay on our own origin; other links open in the system browser.
  w.webContents.on('will-navigate', (e, url) => { if (!sameOrigin(url)) { e.preventDefault(); openOutside(url) } });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: 'allow' };   // e.g. a shared chart image /s/…
    openOutside(url);
    return { action: 'deny' };
  });
  w.loadURL(origin + (o.path ?? ''));
  return w;
}
const showMain = () => { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus() } };
const notify = (title, body) => { if (Notification.isSupported()) { const n = new Notification({ title, body, icon: join(__dirname, 'build', 'icon.png') }); n.on('click', showMain); n.show() } };

function createTray() {
  tray = new Tray(join(__dirname, 'build', 'icon.png'));
  tray.setToolTip('Chart Terminal');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Chart Terminal', click: showMain },
    { label: 'New window', click: () => createWindow(false) },
    { type: 'separator' },
    { label: 'Keep running in the tray when the window closes', type: 'checkbox', checked: settings().tray, click: i => { saveSettings({ ...settings(), tray: i.checked }) } },
    { label: 'Start with Windows', type: 'checkbox', visible: process.platform !== 'linux', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: 'Check for updates', enabled: app.isPackaged, click: () => checkUpdates(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('right-click', () => tray.setContextMenu(menu()));
  tray.on('click', showMain);
}

// Updates: electron-updater reads the feed from app-update.yml, which electron-builder writes only when package.json
// "build.publish" is set. Without it (or offline) the check fails quietly unless asked from the tray.
function checkUpdates(manual = false) {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')) } catch { return }
  autoUpdater.autoDownload = true;
  autoUpdater.once('update-downloaded', i => notify('Update ready', `Chart Terminal ${i.version} will be installed when you quit.`));
  autoUpdater.checkForUpdates().then(r => { if (manual && !r?.isUpdateAvailable) notify('Chart Terminal is up to date', `Version ${app.getVersion()}`) },
    e => { if (manual) dialog.showErrorBox('Chart Terminal', `Could not check for updates: ${e.message}`) });
}
const openOutside = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url) };
// Parsed, not a string prefix: "http://127.0.0.1:9163" must not also match port 91631.
const sameOrigin = url => { try { return new URL(url).origin === origin } catch { return false } };

// ---- Multi-monitor: pop-out windows ----
// The page asks over one IPC channel (ct:win, validated below) for: the display list, a pop-out on a chosen display, moving
// its own window to a display, and re-fitting windows. Each pop-out is the same app at /?po=<kind>&wid=<id> in a window
// with the same hardening as the main one (createWindow). Position, size and display are kept per window in desktop.json
// and restored through the placement maths (app/placement.cjs, built from src/winplace.ts): a display that is gone
// (unplugged) puts the window back on the primary display.
const POP_KINDS = ['chart', 'watch', 'dom', 'tester', 'positions', 'pine', 'alerts'];
const popWins = new Map();        // id -> BrowserWindow
const lastDisplay = new Map();    // id ('main' or a pop-out id) -> id of the display the window was last on
const placement = () => require(join(APP, 'placement.cjs'));
const displays = () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, primary: d.id === primary, label: d.label || `Display ${i + 1}` }));
};
const readPops = () => { const p = settings().pops; return p && typeof p === 'object' && !Array.isArray(p) ? p : {} };
const writePops = p => { const ids = Object.keys(p); for (const k of ids.slice(0, Math.max(0, ids.length - 24))) delete p[k]; saveSettings({ ...settings(), pops: p }) };
const finite = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]));
function trackDisplay(w, id) {
  const note = () => { if (!w.isDestroyed() && !w.isMinimized()) lastDisplay.set(id, screen.getDisplayMatching(w.getBounds()).id) };
  note(); w.on('moved', note); w.on('resized', note);
}
function openPop({ id, kind, pane, displayId }) {
  const had = popWins.get(id);
  if (had && !had.isDestroyed()) { if (had.isMinimized()) had.restore(); had.show(); had.focus(); return true }
  const P = placement(), ds = displays(), pops = readPops(), saved = pops[id];
  const savedWin = saved && finite(saved.rect) ? { rect: saved.rect, displayId: saved.displayId ?? null } : undefined;
  const target = displayId == null ? undefined : ds.find(d => d.id === displayId);
  const r = target ? { rect: P.placeOn(target, savedWin?.rect, popWins.size), displayId: target.id } : P.restoreRect(savedWin, ds);
  const w = createWindow(false, { bounds: r.rect, path: `/?po=${kind}&wid=${id}${kind === 'chart' ? `&pane=${pane}` : ''}` });
  popWins.set(id, w); trackDisplay(w, id);
  pops[id] = { kind, pane: kind === 'chart' ? pane : undefined, open: true, rect: r.rect, displayId: r.displayId }; writePops(pops);
  let t = null;
  const keep = () => { if (w.isDestroyed()) return; const rect = w.getNormalBounds(), p = readPops(); p[id] = { ...p[id], kind, pane: kind === 'chart' ? pane : undefined, rect, displayId: screen.getDisplayMatching(rect).id }; writePops(p) };
  w.on('move', () => { clearTimeout(t); t = setTimeout(keep, 400) });
  w.on('resize', () => { clearTimeout(t); t = setTimeout(keep, 400) });
  w.on('close', () => { clearTimeout(t); keep(); if (!quitting) { const p = readPops(); if (p[id]) { p[id].open = false; writePops(p) } } });   // quitting keeps `open`, so it comes back next start
  w.on('closed', () => { if (popWins.get(id) === w) popWins.delete(id); lastDisplay.delete(id) });
  return true;
}
/** After a display was removed or changed: every window goes back to a display that exists. */
function reflow() {
  const P = placement(), ds = displays();
  const wins = [...popWins.entries(), ...(win ? [['main', win]] : [])];
  for (const [id, w] of wins) {
    if (w.isDestroyed() || w.isMaximized() || w.isFullScreen() || w.isMinimized()) continue;
    const cur = w.getBounds(), res = P.restoreRect({ rect: cur, displayId: lastDisplay.get(id) ?? null }, ds);
    if (res.rect.x !== cur.x || res.rect.y !== cur.y || res.rect.width !== cur.width || res.rect.height !== cur.height) w.setBounds(res.rect);
    lastDisplay.set(id, res.displayId);
  }
}
function restorePops() {
  for (const [id, s] of Object.entries(readPops())) {
    if (!s || s.open !== true || !POP_KINDS.includes(s.kind)) continue;
    const pane = Number.isInteger(s.pane) && s.pane >= 0 && s.pane < 16 ? s.pane : 0;
    if (id !== `po${s.kind}${s.kind === 'chart' ? pane : ''}`) continue;
    try { openPop({ id, kind: s.kind, pane }) } catch (e) { console.error('pop-out restore failed:', e.message) }
  }
}
ipcMain.handle('ct:win', (e, op, arg) => {
  const owner = BrowserWindow.fromWebContents(e.sender);
  if (!owner || !sameOrigin(e.sender.getURL())) return null;
  if (op === 'displays') return displays();
  if (op === 'reflow') { reflow(); return true }
  if (op === 'pop' && arg && typeof arg === 'object') {
    const { id, kind, pane, displayId } = arg;
    if (!POP_KINDS.includes(kind)) return false;
    const p = kind === 'chart' ? pane : undefined;
    if (kind === 'chart' && !(Number.isInteger(p) && p >= 0 && p < 16)) return false;
    if (id !== `po${kind}${kind === 'chart' ? p : ''}`) return false;
    if (displayId != null && typeof displayId !== 'number' && typeof displayId !== 'string') return false;
    return openPop({ id, kind, pane: p, displayId });
  }
  if (op === 'move' && arg && typeof arg === 'object') {
    const d = displays().find(x => x.id === arg.displayId);
    if (!d) return false;
    if (owner.isMaximized() || owner.isFullScreen()) { owner.setFullScreen(false); owner.unmaximize() }
    const b = owner.getBounds();
    owner.setBounds(placement().placeOn(d, { width: b.width, height: b.height }, 0));
    return true;
  }
  return null;
});

// window.prompt() for the app (preload.cjs): a small modal input window; the page waits for the answer like a real prompt.
// The texts travel in the URL hash as JSON and are set with textContent/value, never as HTML.
const PROMPT_PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:14px;font:13px system-ui;background:#1e222d;color:#d1d4dc}
p{margin:0 0 10px;white-space:pre-wrap}input{width:100%;box-sizing:border-box;padding:6px 8px;background:#131722;color:#d1d4dc;border:1px solid #434651;border-radius:4px;font:inherit}
div{margin-top:12px;text-align:right}button{margin-left:6px;padding:5px 14px;border:0;border-radius:4px;background:#2a2e39;color:#d1d4dc;font:inherit}button.on{background:#2962ff;color:#fff}</style>
<p id=m></p><input id=v><div><button id=c>Cancel</button><button id=o class=on>OK</button></div><script>
const [m, d] = JSON.parse(decodeURIComponent(location.hash.slice(1)));
document.getElementById('m').textContent = m; const v = document.getElementById('v'); v.value = d; v.select();
const done = r => { document.title = r === null ? 'ct-cancel' : 'ct-ok:' + encodeURIComponent(r) };
document.getElementById('o').onclick = () => done(v.value); document.getElementById('c').onclick = () => done(null);
addEventListener('keydown', e => { if (e.key === 'Enter') done(v.value); if (e.key === 'Escape') done(null) });
</script>`;
ipcMain.on('ct:prompt', (e, msg, def) => {
  const owner = BrowserWindow.fromWebContents(e.sender);
  if (!owner || !sameOrigin(e.sender.getURL())) { e.returnValue = null; return }
  const p = new BrowserWindow({ parent: owner, modal: true, width: 440, height: 170, resizable: false, minimizable: false, maximizable: false,
    title: 'Chart Terminal', backgroundColor: '#1e222d', autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  let answered = false;
  const answer = v => { if (answered) return; answered = true; e.returnValue = v; if (!p.isDestroyed()) p.destroy() };
  // Plain markers and an encoded value: titles lose control characters and collapse runs of spaces.
  p.webContents.on('page-title-updated', (_ev, t) => { if (t === 'ct-cancel') answer(null); else if (t.startsWith('ct-ok:')) answer(decodeURIComponent(t.slice(6))) });
  p.webContents.on('will-navigate', ev => ev.preventDefault());
  p.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  p.on('closed', () => answer(null));
  p.once('ready-to-show', () => p.show());
  p.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PROMPT_PAGE) + '#' + encodeURIComponent(JSON.stringify([msg, def])));
});

let quitting = false, popAsked = false;
app.on('before-quit', () => {
  quitting = true;
  // Ask the server to exit cleanly (the trade recorder flushes on exit); kill it if it doesn't within 3 s.
  if (server) { server.postMessage('quit'); const s = server; setTimeout(() => s.kill(), 3000).unref() }
});
app.on('second-instance', showMain);
// Without the tray, closing the last window stops the server too (alerts, forward tests, recording).
app.on('window-all-closed', () => { if (!tray || !settings().tray) app.quit() });

// Default-deny for web permissions (camera, microphone, geolocation, ...): the app needs notifications, fullscreen and copying only.
const ALLOWED_PERMISSIONS = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write']);
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', ev => ev.preventDefault()));

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(ALLOWED_PERMISSIONS.has(permission) && sameOrigin(details?.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && sameOrigin(origin || wc?.getURL() || ''));
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);   // the app has its own menus; keep the macOS app menu
  try { await startServer() } catch (e) { dialog.showErrorBox('Chart Terminal', e.message); app.quit(); return }
  try { createTray() } catch (e) { console.error('No tray:', e.message) }   // some Linux desktops have none
  // "Start with Windows" starts hidden in the tray.
  if (!(process.argv.includes('--hidden') && tray)) { createWindow(); restorePops() }
  for (const ev of ['display-removed', 'display-added', 'display-metrics-changed']) screen.on(ev, () => setTimeout(reflow, 400));
  app.on('activate', showMain);
  if (app.isPackaged) setTimeout(() => checkUpdates(), 10_000);
});
