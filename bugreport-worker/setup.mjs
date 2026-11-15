// One-shot set-up of the bug-report Worker: node setup.mjs   (run inside bugreport-worker/, after `npx wrangler login`)
// What it does, in order: asks for the Telegram bot token (hidden, never printed or written to disk), checks it with Telegram, finds your
// chat id from the last message you sent to the bot, writes TELEGRAM_CHAT_ID into wrangler.toml, deploys the Worker, stores the bot token and
// a fresh random CHALLENGE_SECRET as Worker secrets, sends you a test message and checks /challenge. The token only goes to Telegram and Cloudflare.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const win = process.platform === 'win32';
const wr = (args, input) => spawnSync('npx', ['wrangler', ...args], { input, encoding: 'utf8', shell: win });
const clean = s => s.replace(/\x1b\[[0-9;]*m/g, '');

function askHidden(q) {
  return new Promise(res => {
    process.stdout.write(q);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = c => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); return res(buf.trim()) }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1); else buf += ch;
      }
    };
    stdin.on('data', on);
  });
}
const tg = async (token, method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
  return j.result;
};
const fail = m => { console.error('\n✗ ' + m); process.exit(1) };

const who = clean(wr(['whoami']).stdout ?? '');
if (/not authenticated/i.test(who)) fail('Not logged in to Cloudflare. Run:  npx wrangler login');
console.log('✓ Cloudflare login found');

const token = await askHidden('Paste the Telegram bot token (hidden) and press Enter: ');
if (!/^\d+:[\w-]{30,}$/.test(token)) fail('That does not look like a bot token (123456:ABC...).');
let me;
try { me = await tg(token, 'getMe') } catch (e) { fail(`${e.message}. Telegram must be reachable (VPN on?)`) }
console.log(`✓ Bot: @${me.username}`);

let chat = null;
for (let i = 0; i < 2 && !chat; i++) {
  const ups = await tg(token, 'getUpdates', { limit: 100, timeout: 0 }).catch(() => []);
  const c = ups.map(u => u.message?.chat ?? u.edited_message?.chat).filter(c => c && c.type === 'private').at(-1);
  if (c) chat = c;
  else if (i === 0) { console.log(`Open Telegram, send any message (e.g. /start) to @${me.username}, then press Enter here.`); await askHidden('') }
}
if (!chat) fail(`No private message to @${me.username} found. Send it a message and run this again.`);
console.log(`✓ Your chat: ${chat.first_name ?? ''} (${chat.id})`);

const toml = readFileSync('wrangler.toml', 'utf8').replace(/^TELEGRAM_CHAT_ID = "[^"]*"/m, `TELEGRAM_CHAT_ID = "${chat.id}"`);
writeFileSync('wrangler.toml', toml);
console.log('✓ TELEGRAM_CHAT_ID written to wrangler.toml');

let r = wr(['deploy']);
const out = clean(`${r.stdout}\n${r.stderr}`);
if (r.status !== 0) fail('Deploy failed:\n' + out.slice(-1500));
const url = out.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!url) fail('Deployed, but I could not find the address:\n' + out.slice(-800));
console.log(`✓ Deployed: ${url}`);

for (const [name, value] of [['TELEGRAM_BOT_TOKEN', token], ['CHALLENGE_SECRET', randomBytes(32).toString('hex')]]) {
  r = wr(['secret', 'put', name], value + '\n');
  if (r.status !== 0) fail(`Could not store ${name}:\n` + clean(`${r.stdout}\n${r.stderr}`).slice(-800));
  console.log(`✓ Secret ${name} stored`);
}

try { await tg(token, 'sendMessage', { chat_id: chat.id, text: 'Chart Terminal: the bug-report receiver is set up. Reports will arrive here.' }) } catch (e) { console.log('! Test message failed: ' + e.message) }
const ch = await fetch(`${url}/challenge`, { signal: AbortSignal.timeout(20_000) }).then(x => x.json()).catch(e => ({ error: e.message }));
console.log(ch.salt ? '✓ /challenge answers (the receiver is live)' : '! /challenge did not answer yet: ' + JSON.stringify(ch) + ' (a new workers.dev address can take a minute; also needs VPN from Iran)');
console.log(`\nRECEIVER ADDRESS: ${url}\nTell Claude this address; it goes into the app builds.`);
