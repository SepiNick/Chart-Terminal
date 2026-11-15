// "Report a bug": a description, up to three screenshots and the app's own diagnostic text (already redacted: no keys, tokens or
// addresses; see diagnostics.ts), sent to the developer. Where it goes:
//   · a receiver is built in (VITE_BUG_REPORT_URL = the bugreport-worker/ address): the app first solves a small proof-of-work
//     puzzle the receiver hands out (the captcha: bots cannot flood it for free), then posts the report there;
//   · else, connected to a server -> POST /api/bugreport (kept on that server and sent to its Telegram chat, server/bugreport.ts);
//   · else, or whenever sending fails (no network, receiver unreachable), the report can be saved as a file the user sends by hand.
import { dialog } from './login.ts';
import { collectReport, crashGate, crashSignature, isNoise, recentErrors, redact } from './diagnostics.ts';
import { api, serverMode } from './sync.ts';
import { esc, toast } from './store.ts';

declare const __APP_VERSION__: string | undefined;
const REPORT_URL = (import.meta.env?.VITE_BUG_REPORT_URL as string | undefined) ?? '';
const MAX_IMAGES = 3, MAX_SIDE = 1600, MAX_BITS = 24;   // MAX_BITS: a hostile receiver cannot make the phone burn minutes on a puzzle

const zeroBits = (u8: Uint8Array) => { let n = 0; for (const b of u8) { if (b === 0) { n += 8; continue } return n + Math.clz32(b) - 24 } return n };
interface Puzzle { salt: string; difficulty: number; exp: number; sig: string }
/** Finds n so that SHA-256("<salt>:<n>") starts with `difficulty` zero bits (64 hashes at a time, so the page stays responsive). */
async function solve(c: Puzzle): Promise<Puzzle & { n: number }> {
  if (!(c.difficulty >= 1 && c.difficulty <= MAX_BITS) || typeof c.salt !== 'string') throw Error('The report receiver sent an unusable puzzle');
  const enc = new TextEncoder();
  for (let n = 0; ; n += 64) {
    const hs = await Promise.all(Array.from({ length: 64 }, (_, i) => crypto.subtle.digest('SHA-256', enc.encode(`${c.salt}:${n + i}`))));
    for (let i = 0; i < 64; i++) if (zeroBits(new Uint8Array(hs[i])) >= c.difficulty) return { ...c, n: n + i };
  }
}
/** Where a report goes (see the top of the file). Throws when it cannot be delivered; `null` when there is nowhere to send it at all. */
async function deliver(body: object, status: (s: string) => void): Promise<boolean> {
  if (/^https:\/\//.test(REPORT_URL)) await sendToReceiver(REPORT_URL, body, status);
  else if (serverMode) await api('/api/bugreport', { method: 'POST', body });
  else return false;
  return true;
}
async function sendToReceiver(base: string, body: object, status: (s: string) => void) {
  const root = base.replace(/\/+$/, '');
  status('Checking that you are not a bot…');
  const ch = await fetch(`${root}/challenge`, { signal: AbortSignal.timeout(15_000) });
  if (!ch.ok) throw Error(`The report receiver answered ${ch.status}`);
  const captcha = await solve(await ch.json() as Puzzle);
  status('Sending…');
  const r = await fetch(`${root}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, captcha }), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `The report receiver answered ${r.status}`);
}

/** A picked image as a jpeg data URL no larger than 1600 px (screenshots shrink a lot; a camera photo shrinks even more). */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file), k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

interface App { charts: number; theme: string; lang: string; charts_info: string }
async function payload(description: string, contact: string, withInfo: boolean, images: string[], app: App) {
  const ver = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  const info = withInfo ? `App version: ${ver}\nScreen: ${innerWidth}x${innerHeight} @${devicePixelRatio}\nCharts: ${app.charts_info}\n\n${await collectReport(app)}` : '';
  return { description, contact, info, images };
}

export function openBugReport(app: App) {
  const picked: string[] = [];
  dialog('Report a bug', `
    <div class="form"><label>What went wrong? <small class="muted">What you did, what you expected, what happened.</small></label>
      <textarea name="d" rows="6" maxlength="5000" required placeholder="Describe the problem"></textarea></div>
    <div class="form"><label>Screenshots <small class="muted">(up to ${MAX_IMAGES}, optional)</small></label>
      <input type="file" name="f" accept="image/*" multiple><div class="br-thumbs row wrap"></div></div>
    <div class="form"><label>How can we reach you? <small class="muted">(optional)</small></label><input name="c" maxlength="200" autocomplete="off" placeholder="email or Telegram"></div>
    <label class="row"><input type="checkbox" name="i" checked> Include diagnostic info: version, system, screen size, chart symbols and settings, recent app errors. No keys, passwords or tokens.</label>
    <div class="ct-err" role="alert"></div><div class="muted br-st" role="status"></div>
    <div class="row"><span class="grow"></span><button type="button" data-a="save" hidden>Save as a file</button><button type="button" data-a="cancel">Cancel</button><button class="on" data-a="send">Send report</button></div>`, (f, close) => {
    let last: object | null = null;
    const err = f.querySelector<HTMLElement>('.ct-err')!, st = f.querySelector<HTMLElement>('.br-st')!, thumbs = f.querySelector<HTMLElement>('.br-thumbs')!, inp = f.querySelector<HTMLInputElement>('[name=f]')!;
    const draw = () => { thumbs.innerHTML = picked.map((u, i) => `<span class="br-th"><img src="${esc(u)}" alt="Screenshot ${i + 1}"><button type="button" class="x" data-rm="${i}" aria-label="Remove screenshot ${i + 1}">×</button></span>`).join('') };
    inp.onchange = async () => {
      err.textContent = '';
      for (const file of [...(inp.files ?? [])]) {
        if (picked.length >= MAX_IMAGES) { err.textContent = `At most ${MAX_IMAGES} screenshots`; break }
        try { picked.push(await shrink(file)) } catch { err.textContent = `${file.name} is not an image the app can read` }
      }
      inp.value = ''; draw();
    };
    f.onclick = async e => {
      const t = e.target as HTMLElement, rm = t.closest<HTMLElement>('[data-rm]');
      if (rm) { picked.splice(+rm.dataset.rm!, 1); draw(); return }
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'cancel') return close();
      if (a === 'save' && last) { saveFile(last); toast('Report saved as a file: please send it to the developer', 6000); return close() }
      if (a !== 'send') return;
      const d = (f.elements.namedItem('d') as HTMLTextAreaElement).value.trim();
      if (d.length < 5) { err.textContent = 'Describe the problem in a few words'; return }
      const btn = t.closest<HTMLButtonElement>('button')!; btn.disabled = true; err.textContent = '';
      try {
        const body = await payload(d, (f.elements.namedItem('c') as HTMLInputElement).value.trim(), (f.elements.namedItem('i') as HTMLInputElement).checked, picked, app);
        last = body;
        if (!await deliver(body, s => { st.textContent = s })) { saveFile(body); toast('Report saved as a file: please send it to the developer', 6000); return close() }
        toast('Report sent. Thank you!'); close();
      } catch (x) {
        err.textContent = `Could not send: ${(x as Error).message}. Your text is kept; you can save the report as a file and send that.`; st.textContent = '';
        btn.disabled = false; f.querySelector<HTMLElement>('[data-a=save]')!.hidden = false;
      }
    };
  });
}

function saveFile(body: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  a.download = `chart-terminal-bug-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- Automatic crash reports ----------------------------------------------------------------------------------------------------
// When the app throws an uncaught error / unhandled rejection (or the desktop window's renderer dies), the same diagnostic text the
// "Report a bug" dialog builds (already redacted) is sent without asking, and the user is told in a toast at once and again when it was
// sent. Guard rails: at most 3 a session, a minute apart, the same bug once a day; can be switched off; if it cannot be sent it is kept
// on this device (the last 5) and tried again at the next start.
const AUTO_KEY = 'ct.autoCrash', SEEN_KEY = 'ct.crashSeen', QUEUE_KEY = 'ct.crashQueue';
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode / full: the report is simply not kept */ } },
};
export const autoCrashOn = () => ls.get(AUTO_KEY) !== 'off';
export const setAutoCrash = (on: boolean) => ls.set(AUTO_KEY, on ? 'on' : 'off');
const readJson = <T,>(k: string, d: T): T => { try { return JSON.parse(ls.get(k) ?? '') as T } catch { return d } };

export function installCrashReporter(app: () => App) {
  const seen = readJson<Record<string, number>>(SEEN_KEY, {}), gate = crashGate(seen);
  let busy = false;
  const report = async (kind: string, msg: string) => {
    msg = redact(String(msg)).replace(/\s+/g, ' ').slice(0, 300);
    const top = recentErrors().at(-1)?.stack;   // where it happened: the first frames, so the report is enough to find the line
    if (!autoCrashOn() || busy || isNoise(msg, top) || !gate(crashSignature(kind, msg), Date.now())) return;
    ls.set(SEEN_KEY, JSON.stringify(seen));
    busy = true;
    toast('The app hit a problem. A crash log was captured (no passwords, keys or addresses) and is being sent to the developer. You can turn this off in the ☰ menu.', 9000);
    try {
      const body = await payload(`Automatic crash report (${kind}): ${msg}${top ? `
at ${top.split(' | ').slice(0, 3).join(' | ')}` : ''}`, '', true, [], app());
      try {
        if (await deliver(body, () => {})) toast('Crash log sent. Thank you!', 4000);
        else { keep(body); toast('Crash log saved on this device. Use ☰ → Report a bug to send it.', 7000) }
      } catch { keep(body); toast('Could not send the crash log now. It is saved and will be sent at the next start.', 7000) }
    } finally { busy = false }
  };
  addEventListener('error', e => { if (e.target === window || !(e.target instanceof Element)) void report('error', e.message || (e.error as Error | undefined)?.message || '') });
  addEventListener('unhandledrejection', e => { const r = e.reason as { message?: string } | undefined; void report('promise', String(r?.message ?? r ?? '')) });
  // The desktop shell tells the page when its previous renderer process died (main.cjs).
  addEventListener('ct-renderer-gone', e => void report('renderer', String((e as CustomEvent<string>).detail ?? 'the window process crashed')));
  // A log that could not be sent last time goes out now (one at a time, only if a receiver exists).
  const q = readJson<object[]>(QUEUE_KEY, []);
  if (q.length && autoCrashOn()) setTimeout(async () => {
    try { if (await deliver(q[0], () => {})) { ls.set(QUEUE_KEY, JSON.stringify(q.slice(1))); toast('A saved crash log was sent. Thank you!', 4000) } } catch { /* still offline: stays queued */ }
  }, 15_000);
}
function keep(body: object) { ls.set(QUEUE_KEY, JSON.stringify([...readJson<object[]>(QUEUE_KEY, []), body].slice(-5))) }
