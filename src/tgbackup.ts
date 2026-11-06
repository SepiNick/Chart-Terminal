// Encrypted backup to Telegram, and restore from such a file. Encryption happens here, in the browser: AES-256-GCM with a key from
// the user's passphrase (PBKDF2, 250 000 rounds). The server only forwards the encrypted file and never sees the passphrase.
import { api, downloadBackup, localSnapshot } from './sync.ts';
import { store, toast } from './store.ts';
import { dialog, val } from './login.ts';
import { b64, decryptText, enc, encryptText } from './backupcrypto.ts';

const FORM = (extra: string) => `<div class="form"><label>Passphrase</label><input type="password" name="pp" autocomplete="off">${extra}</div>
  <div class="ct-err"></div><div class="row"><span class="grow"></span><button type="button" data-x>Cancel</button><button class="on">Continue</button></div>`;

export function backupToTelegram() {
  dialog('Back up to Telegram', `<p class="muted">Your layouts, drawings, alerts, watchlists and settings are encrypted here with a passphrase and sent to your Telegram chat with the bot. API keys are never included. If you lose the passphrase the backup cannot be opened.</p>${FORM('<label>Repeat</label><input type="password" name="pp2" autocomplete="off">')}`, (f, close) => {
    const err = f.querySelector<HTMLElement>('.ct-err')!;
    f.querySelector<HTMLElement>('[data-x]')!.onclick = close;
    f.onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      const pp = val(f, 'pp');
      if (pp.length < 8) return void (err.textContent = 'Use at least 8 characters');
      if (pp !== val(f, 'pp2')) return void (err.textContent = 'The passphrases do not match');
      try {
        const file = await encryptText(pp, JSON.stringify(localSnapshot()));
        await api('/api/notify/telegram/backup', { body: { name: `chart-terminal-${new Date().toISOString().slice(0, 10)}.enc.json`, data: b64(enc.encode(file)) } });
        toast('Backup sent to Telegram'); close();
      } catch (x) { err.textContent = (x as Error).message }
    };
  });
}

export function restoreFromFile() {
  const pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.json,application/json';
  pick.onchange = async () => {
    const file = pick.files?.[0]; if (!file) return;
    if (file.size > 8 * 1024 * 1024) return void toast('That file is too large to be a backup');
    const text = await file.text();
    dialog('Restore from backup', `<p class="muted">This replaces your layouts, drawings, alerts, watchlists and settings with the ones in the file. A copy of the current ones is downloaded first.</p>${FORM('')}`, (f, close) => {
      const err = f.querySelector<HTMLElement>('.ct-err')!;
      f.querySelector<HTMLElement>('[data-x]')!.onclick = close;
      f.onsubmit = async e => {
        e.preventDefault(); err.textContent = '';
        try {
          const snap = JSON.parse(await decryptText(val(f, 'pp'), text)) as Record<string, unknown>;
          if (!snap || typeof snap !== 'object' || Array.isArray(snap)) throw Error('The backup is not valid');
          downloadBackup();
          for (const [k, v] of Object.entries(snap)) store.set(k, v);
          toast('Backup restored'); close(); setTimeout(() => location.reload(), 600);
        } catch (x) { err.textContent = (x as Error).message }
      };
    });
  };
  pick.click();
}
