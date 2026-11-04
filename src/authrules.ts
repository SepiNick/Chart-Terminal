// Account rules mirrored from the public server (server/core/users.ts) so mistakes show before a request is sent.
// The server stays the judge (it also checks a list of common passwords); its message is shown when it refuses.
export function checkName(n: string): string {
  const name = n.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw Error('Username: 3 to 32 characters, letters, digits, . _ -');
  return name;
}
export function checkPassword(pw: string, name: string): string {
  if (pw.length < 10) throw Error('Password must be at least 10 characters');
  if (pw.length > 200) throw Error('Password must be at most 200 characters');
  const l = pw.toLowerCase();
  if (/^(.)\1+$/.test(pw) || l === name || (name.length >= 4 && l.includes(name))) throw Error('That password is too easy to guess');
  return pw;
}
/** Recovery codes as shown / downloaded: one per line, numbered. */
export const formatRecoveryCodes = (codes: string[], who = '') =>
  `Chart Terminal recovery codes${who ? ` for ${who}` : ''}\nEach code works once. Keep them somewhere safe and private.\n\n${codes.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`;
/** Pull a code list out of a server answer; [] when absent or malformed. */
export const codesOf = (j: unknown): string[] => { const c = (j as { recoveryCodes?: unknown } | null)?.recoveryCodes; return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [] };
