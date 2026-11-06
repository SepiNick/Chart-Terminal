// Passphrase encryption for backup files: AES-256-GCM, key from PBKDF2-SHA256 (250 000 rounds). Pure WebCrypto, no DOM.
const ITER = 250_000;
export const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64 = (u: Uint8Array) => { let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s) };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function keyOf(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptText(pass: string, text: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(pass, salt), enc.encode(text)));
  return JSON.stringify({ app: 'chart-terminal', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) });
}
export async function decryptText(pass: string, file: string): Promise<string> {
  let j: { app?: string; v?: number; iter?: number; salt?: string; iv?: string; data?: string };
  try { j = JSON.parse(file) } catch { throw Error('This is not a Chart Terminal backup file') }
  if (j.app !== 'chart-terminal' || j.v !== 1 || !j.salt || !j.iv || !j.data || j.iter !== ITER) throw Error('This is not a Chart Terminal backup file');
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.iv) as BufferSource }, await keyOf(pass, unb64(j.salt)), unb64(j.data) as BufferSource)) }
  catch { throw Error('Wrong passphrase, or the file is damaged') }
}
