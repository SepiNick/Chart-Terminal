// Chart Terminal desktop shell: starts the bundled server on a free 127.0.0.1 port with the data in the user's app-data
// folder, then shows the app in a window from that server (same origin, so login cookies, /api and /ws work as usual).
const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, shell, utilityProcess } = require('electron');
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

function createWindow(main = true) {
  const w = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#131722',
    title: 'Chart Terminal', icon: join(__dirname, 'build', 'icon.png'),
    // The page only talks HTTP to its own server; the preload only adds window.prompt(). It keeps running when the
    // window is hidden in the tray (live prices, alert notifications), so it is not throttled in the background.
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(__dirname, 'preload.cjs'), backgroundThrottling: false },
  });
  if (main) {
    win = w;
    // Closing the main window hides it in the tray: the server keeps running (alerts, forward tests, recording).
    w.on('close', e => {
      if (quitting || !settings().tray || !tray) return;
      e.preventDefault(); w.hide();
      if (!settings().trayTold) { saveSettings({ ...settings(), trayTold: true }); notify('Chart Terminal is still running', 'Alerts and forward tests keep working. Quit from the tray icon.') }
    });
    w.on('closed', () => { if (win === w) win = null });
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
  w.loadURL(origin);
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

let quitting = false;
app.on('before-quit', () => {
  quitting = true;
  // Ask the server to exit cleanly (the trade recorder flushes on exit); kill it if it doesn't within 3 s.
  if (server) { server.postMessage('quit'); const s = server; setTimeout(() => s.kill(), 3000).unref() }
});
app.on('second-instance', showMain);
// Without the tray, closing the last window stops the server too (alerts, forward tests, recording).
app.on('window-all-closed', () => { if (!tray || !settings().tray) app.quit() });

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);   // the app has its own menus; keep the macOS app menu
  try { await startServer() } catch (e) { dialog.showErrorBox('Chart Terminal', e.message); app.quit(); return }
  try { createTray() } catch (e) { console.error('No tray:', e.message) }   // some Linux desktops have none
  // "Start with Windows" starts hidden in the tray.
  if (!(process.argv.includes('--hidden') && tray)) createWindow();
  app.on('activate', showMain);
  if (app.isPackaged) setTimeout(() => checkUpdates(), 10_000);
});
