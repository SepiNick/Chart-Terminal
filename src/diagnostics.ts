// "Report a problem" without a support desk: one text report with the facts someone needs to diagnose an empty chart,
// a failing feed or a crash, and none of the things that must not leave the machine (keys, tokens, passwords, addresses
// of home-network servers). The report is shown to the user, who copies it where they like; nothing is sent anywhere.
import { serverFetch } from './servers.ts';

export interface ErrorEntry { at: number; kind: 'error' | 'promise' | 'console'; msg: string }
const LOG: ErrorEntry[] = [];
const MAX = 40;

/** Removes what must not be shared: bearer tokens, token/key/password parameters, emails, long secrets, IPv4 and local addresses. */
export function redact(s: string): string {
  return s
    .replace(/\b(Bearer|Token|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b(token|key|secret|password|passwd|pass|pwd|pw|apikey|api_key|authorization|signature|sig)(["']?\s*[:=]\s*["']?)[^\s"'&,;]{4,}/gi, '$1$2[redacted]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$|["'])/g, '[redacted]');
}
const clip = (s: string, n = 300) => redact(String(s).replace(/\s+/g, ' ')).slice(0, n);

/** Keep the most recent errors, for the report. Call once at start. */
export function installErrorLog(w: Pick<Window, 'addEventListener'> & { console?: Console } = window) {
  const add = (kind: ErrorEntry['kind'], msg: string) => { LOG.push({ at: Date.now(), kind, msg: clip(msg) }); if (LOG.length > MAX) LOG.shift() };
  w.addEventListener('error', e => add('error', `${(e as ErrorEvent).message ?? e}`));
  w.addEventListener('unhandledrejection', e => add('promise', String((e as PromiseRejectionEvent).reason?.message ?? (e as PromiseRejectionEvent).reason)));
  const c = w.console;
  if (c) { const orig = c.error.bind(c); c.error = (...a: unknown[]) => { add('console', a.map(x => (x instanceof Error ? x.message : typeof x === 'string' ? x : '')).filter(Boolean).join(' ')); orig(...a) } }
}
export const recentErrors = () => [...LOG];
export const clearErrors = () => { LOG.length = 0 };

export interface DiagInput {
  now: number;
  browser: { ua: string; language: string; tz: string; online: boolean; cores?: number; memoryGb?: number };
  app: { origin: string; lang: string; theme: string; charts: number; storageKeys?: number; storageKb?: number };
  server?: { mode?: string; version?: string; features?: string; error?: string };
  sources?: { source: string; ok: boolean; ms: number; detail: string }[] | { error: string };
  errors: ErrorEntry[];
}
/** The report text. Pure: everything it prints comes from `d`, so it is testable and cannot leak by accident. */
export function buildReport(d: DiagInput): string {
  const L: string[] = [`Chart Terminal diagnostics · ${new Date(d.now).toISOString()}`, ''];
  L.push('Browser', `  ${clip(d.browser.ua, 200)}`, `  language ${d.browser.language} · time zone ${d.browser.tz} · ${d.browser.online ? 'online' : 'OFFLINE'}${d.browser.cores ? ` · ${d.browser.cores} cores` : ''}${d.browser.memoryGb ? ` · ${d.browser.memoryGb} GB` : ''}`, '');
  L.push('App', `  ${redact(d.app.origin)} · interface ${d.app.lang} · ${d.app.theme} theme · ${d.app.charts} chart(s)`, ...(d.app.storageKb != null ? [`  local storage ${d.app.storageKeys} keys, about ${d.app.storageKb} KB`] : []), '');
  L.push('Server');
  if (!d.server) L.push('  not checked');
  else if (d.server.error) L.push(`  not reachable: ${clip(d.server.error, 160)}`);
  else L.push(`  ${d.server.mode ?? '?'} mode · version ${d.server.version ?? '?'}${d.server.features ? ` · ${clip(d.server.features, 120)}` : ''}`);
  L.push('', 'Data sources (asked from the server just now)');
  if (!d.sources) L.push('  not checked');
  else if ('error' in d.sources) L.push(`  could not ask: ${clip(d.sources.error, 160)}`);
  else for (const s of d.sources) L.push(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.source.padEnd(12)} ${String(s.ms).padStart(5)} ms  ${clip(s.detail, 140)}`);
  L.push('', `Recent errors (${d.errors.length})`);
  if (!d.errors.length) L.push('  none');
  for (const e of d.errors.slice(-20)) L.push(`  ${new Date(e.at).toISOString().slice(11, 19)} ${e.kind.padEnd(7)} ${e.msg}`);
  L.push('', 'No keys, tokens, passwords, e-mail addresses or IP addresses are included; check the text before you share it.');
  return L.join('\n');
}

/** Gather everything and build the text. `charts` and the theme come from the caller (this module knows nothing about panes). */
export async function collectReport(app: { charts: number; theme: string; lang: string }): Promise<string> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let storageKeys: number | undefined, storageKb: number | undefined;
  try { let n = 0, b = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('ct.')) { n++; b += k.length + (localStorage.getItem(k)?.length ?? 0) } } storageKeys = n; storageKb = Math.round((b * 2) / 1024) } catch {}
  const d: DiagInput = {
    now: Date.now(),
    browser: { ua: nav?.userAgent ?? '', language: nav?.language ?? '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, online: nav?.onLine ?? true, cores: nav?.hardwareConcurrency, memoryGb: (nav as { deviceMemory?: number } | undefined)?.deviceMemory },
    app: { origin: typeof location !== 'undefined' ? location.origin : '', ...app, storageKeys, storageKb },
    errors: recentErrors(),
  };
  try {
    const r = await serverFetch('/api/auth/status');
    const j = await r.json().catch(() => null) as { mode?: string; version?: string; features?: Record<string, boolean> } | null;
    if (!r.ok || !j || typeof j !== 'object') throw new Error('no Chart Terminal server answered (the app is running without a data server)');
    d.server = { mode: j.mode, version: j.version, features: Object.entries(j.features ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') };
  } catch (e) { d.server = { error: (e as Error).message } }
  if (d.server && !d.server.error) {
    try { const r = await serverFetch('/api/diag/sources'); d.sources = r.ok ? ((await r.json()) as { sources: NonNullable<DiagInput['sources']> & unknown[] }).sources : { error: `HTTP ${r.status}` } }
    catch (e) { d.sources = { error: (e as Error).message } }
  }
  return buildReport(d);
}
