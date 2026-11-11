// "Report a bug": a description, up to three screenshots and the app's own diagnostic text (already redacted: no keys, tokens or
// addresses; see diagnostics.ts), sent to the developer. Where it goes:
//   · connected to a server -> POST /api/bugreport (kept on the server and sent to its Telegram chat, server/bugreport.ts);
//   · else, if a report address is built in (VITE_BUG_REPORT_URL, an https endpoint that takes the same JSON) -> POST there;
//   · else the report is saved as a file the user sends by hand.
import { dialog } from './login.ts';
import { collectReport } from './diagnostics.ts';
import { api, serverMode } from './sync.ts';
import { esc, toast } from './store.ts';

declare const __APP_VERSION__: string | undefined;
const REPORT_URL = (import.meta.env?.VITE_BUG_REPORT_URL as string | undefined) ?? '';
const MAX_IMAGES = 3, MAX_SIDE = 1600;

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
    <div class="ct-err" role="alert"></div>
    <div class="row"><span class="grow"></span><button type="button" data-a="cancel">Cancel</button><button class="on" data-a="send">Send report</button></div>`, (f, close) => {
    const err = f.querySelector<HTMLElement>('.ct-err')!, thumbs = f.querySelector<HTMLElement>('.br-thumbs')!, inp = f.querySelector<HTMLInputElement>('[name=f]')!;
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
      if (a !== 'send') return;
      const d = (f.elements.namedItem('d') as HTMLTextAreaElement).value.trim();
      if (d.length < 5) { err.textContent = 'Describe the problem in a few words'; return }
      const btn = t.closest<HTMLButtonElement>('button')!; btn.disabled = true; err.textContent = '';
      try {
        const body = await payload(d, (f.elements.namedItem('c') as HTMLInputElement).value.trim(), (f.elements.namedItem('i') as HTMLInputElement).checked, picked, app);
        if (serverMode) { await api('/api/bugreport', { method: 'POST', body }); toast('Report sent. Thank you!'); close() }
        else if (/^https:\/\//.test(REPORT_URL)) {
          const r = await fetch(REPORT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
          if (!r.ok) throw Error(`The report server answered ${r.status}`);
          toast('Report sent. Thank you!'); close();
        } else { saveFile(body); toast('Report saved as a file: please send it to the developer', 6000); close() }
      } catch (x) { err.textContent = `Could not send: ${(x as Error).message}. Your text is kept.`; btn.disabled = false }
    };
  });
}

function saveFile(body: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  a.download = `chart-terminal-bug-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
