// Chart Terminal desktop shell: starts the bundled server on a free 127.0.0.1 port with the data in the user's app-data
// folder, then shows the app in a window from that server (same origin, so login cookies, /api and /ws work as usual).
const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron');
const { createServer } = require('node:net');
const { join } = require('node:path');

// CT_USER_DATA: a separate data folder for testing, so a test login never lands in the real app's data.
if (process.env.CT_USER_DATA) app.setPath('userData', process.env.CT_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();   // two servers must never share one database

const APP = join(__dirname, 'app');
let server = null, win = null, origin = '';

/** A free loopback port (the dev server or the user's own server may hold 8787). */
const freePort = () => new Promise((ok, fail) => {
  const s = createServer().once('error', fail).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) });
});

async function startServer() {
  const port = await freePort();
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

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#131722',
    title: 'Chart Terminal', icon: join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },   // the page only talks HTTP to its own server
  });
  win.once('ready-to-show', () => win.show());
  // Stay on our own origin; other links open in the system browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); openOutside(url) } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' };   // e.g. a shared chart image /s/…
    openOutside(url);
    return { action: 'deny' };
  });
  win.loadURL(origin);
}
const openOutside = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url) };

let quitting = false;
app.on('before-quit', () => {
  quitting = true;
  // Ask the server to exit cleanly (the trade recorder flushes on exit); kill it if it doesn't within 3 s.
  if (server) { server.postMessage('quit'); const s = server; setTimeout(() => s.kill(), 3000).unref() }
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } });
app.on('window-all-closed', () => app.quit());   // closing the window stops the server too (alerts, forward tests, recording)

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);   // the app has its own menus; keep the macOS app menu
  try { await startServer() } catch (e) { dialog.showErrorBox('Chart Terminal', e.message); app.quit(); return }
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() });
});
