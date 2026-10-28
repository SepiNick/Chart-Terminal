// Electron has no window.prompt(); the app uses it for names (layouts, templates, intervals…). This puts a synchronous
// prompt back: main.cjs shows a small modal input window and answers, like the browser's own prompt does.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('ctDesktop', { prompt: (msg, def) => ipcRenderer.sendSync('ct:prompt', String(msg ?? ''), def == null ? '' : String(def)) });
webFrame.executeJavaScript('window.prompt = (m, d) => window.ctDesktop.prompt(m, d)');
