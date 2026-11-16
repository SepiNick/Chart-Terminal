// Electron has no window.prompt(); the app uses it for names (layouts, templates, intervals…). This puts a synchronous
// prompt back: main.cjs shows a small modal input window and answers, like the browser's own prompt does.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// win: the one channel for pop-out windows and monitors (validated in main.cjs): displays, pop, move, reflow.
contextBridge.exposeInMainWorld('ctDesktop', {
  prompt: (msg, def) => ipcRenderer.sendSync('ct:prompt', String(msg ?? ''), def == null ? '' : String(def)),
  win: (op, arg) => ipcRenderer.invoke('ct:win', String(op), arg),
});
// Servers heard on the LAN (UDP beacon, validated in discovery.cjs): Promise of [{id,name,urls,v,mode,twofa,ageMs}]. Data only.
contextBridge.exposeInMainWorld('ctDiscover', () => ipcRenderer.invoke('ct:discover'));
webFrame.executeJavaScript('window.prompt = (m, d) => window.ctDesktop.prompt(m, d)');
