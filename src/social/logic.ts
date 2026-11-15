// Community: pure helpers (no DOM, no app imports) so they run in node tests.
export type Dir = 'long' | 'short' | 'neutral';
export interface PostLike { id: number }

export const LIMITS = { title: 120, body: 5000, comment: 1000, chat: 500, reason: 300, rooms: 3 } as const;
const TFS = ['1s', '1m', '3m', '5m', '15m', '30m', '45m', '1h', '2h', '3h', '4h', '6h', '12h', '1d', '3d', '1w', '1M'];
export const SYM_OK = /^([A-Za-z0-9]+:)?[A-Za-z0-9_.؀-ۿ/-]{1,40}$/;
export const TF_OK = (tf: string) => TFS.includes(tf) || /^\d{1,4}[smhdwM]$/.test(tf);

export const escapeHtml = (s: unknown) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Strip NUL/control characters (keeps tab and newline), collapse 4+ line breaks to 3, trim. Mirrors the server's hygiene. */
export function cleanText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
}

/** "now", "5m", "3h", "2d", "6w" or a date; ts in seconds or milliseconds. */
export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - (ts > 1e12 ? ts : ts * 1000)) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 60 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  return new Date(ts > 1e12 ? ts : ts * 1000).toISOString().slice(0, 10);
}

/** User text -> safe HTML: everything escaped, only http(s) URLs become links. Never interprets markup. */
export function linkify(text: string): string {
  let out = '', last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const raw = m[0].replace(/[.,;:!?)\]}]+$/, '');
    let ok = false;
    try { ok = /^https?:$/.test(new URL(raw).protocol) } catch { /* not a URL */ }
    if (!ok) continue;
    out += escapeHtml(text.slice(last, m.index)) + `<a href="${escapeHtml(raw)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(raw)}</a>`;
    last = m.index! + raw.length;
  }
  return out + escapeHtml(text.slice(last));
}

/** Chat room of a symbol: "sym:<SYMBOL>" (upper case); the shared room is "general". */
export const symbolRoom = (symbol: string) => `sym:${symbol.trim().toUpperCase()}`;
export const isRoom = (r: string) => r === 'general' || (r.startsWith('sym:') && SYM_OK.test(r.slice(4)));

export interface PostDraft { symbol: string; tf: string; dir: string; title?: string; body: string; snap?: string }
/** First problem with a draft, or '' when it can be sent. Also returns the cleaned values. */
export function validatePost(d: PostDraft): { error: string; value: PostDraft } {
  const value: PostDraft = { symbol: d.symbol.trim().toUpperCase(), tf: d.tf.trim(), dir: d.dir, title: cleanText(d.title ?? ''), body: cleanText(d.body), snap: d.snap };
  const error = !SYM_OK.test(value.symbol) ? 'Enter a valid symbol'
    : !TF_OK(value.tf) ? 'Enter a valid timeframe'
    : !['long', 'short', 'neutral'].includes(value.dir) ? 'Pick Long, Short or Neutral'
    : value.title!.length > LIMITS.title ? `Title is limited to ${LIMITS.title} characters`
    : !value.body ? 'Write something first'
    : value.body.length > LIMITS.body ? `Text is limited to ${LIMITS.body} characters`
    : '';
  return { error, value };
}

/** Merge pages / pushes into one list, newest (highest id) first, one entry per id (the later copy wins). */
export function mergeById<T extends PostLike>(cur: T[], incoming: T[]): T[] {
  const m = new Map<number, T>();
  for (const x of cur) m.set(x.id, x);
  for (const x of incoming) m.set(x.id, x);
  return [...m.values()].sort((a, b) => b.id - a.id);
}
