// House Clerk financial disclosures (STOCK Act) for the trader-pelosi skill: the yearly filing index (a ZIP holding
// one XML) and Periodic Transaction Report PDFs turned into text by `pdftotext -layout`, as the original does
// (set CT_PDFTOTEXT to its path if it is not on PATH). Fixed host, validated year and document id, cached.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { HttpError, bad, route } from './core/http.ts';

const BASE = 'https://disclosures-clerk.house.gov/public_disc/';
/** Swappable for tests. */
export const deps = { fetch: (url: string) => fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'ChartTerminal/0.1 (personal research app)' } }) };
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(k: string, ttl: number, load: () => Promise<T>): Promise<T> { const c = cache.get(k); if (c && Date.now() - c.at < ttl) return c.data as T; const d = await load(); cache.set(k, { at: Date.now(), data: d }); if (cache.size > 300) cache.delete(cache.keys().next().value!); return d }
async function bytes(url: string) { const r = await deps.fetch(url); if (!r.ok) throw new HttpError(502, `House Clerk returned ${r.status}`); return Buffer.from(await r.arrayBuffer()) }

/** The first .xml file of a ZIP (stored or deflated), read from its central directory. */
export function unzipXml(z: Buffer): Buffer {
  if (z[0] !== 0x50 || z[1] !== 0x4b) return z;
  let e = z.length - 22; while (e >= 0 && z.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new HttpError(502, 'Broken ZIP');
  let p = z.readUInt32LE(e + 16);
  for (let n = z.readUInt16LE(e + 10); n > 0; n--) {
    const method = z.readUInt16LE(p + 10), size = z.readUInt32LE(p + 20), nl = z.readUInt16LE(p + 28), xl = z.readUInt16LE(p + 30), cl = z.readUInt16LE(p + 32), off = z.readUInt32LE(p + 42), name = z.toString('utf8', p + 46, p + 46 + nl);
    if (name.toLowerCase().endsWith('.xml')) { const d = off + 30 + z.readUInt16LE(off + 26) + z.readUInt16LE(off + 28), raw = z.subarray(d, d + size); return method === 0 ? Buffer.from(raw) : inflateRawSync(raw) }
    p += 46 + nl + xl + cl;
  }
  throw new HttpError(502, 'No XML inside the index ZIP');
}
const TYPES: Record<string, string> = { P: 'Periodic Transaction Report', O: 'Annual report', A: 'Amendment', C: 'Candidate report', X: 'Extension', T: 'Termination report', W: 'Waiver', D: 'Disclosure (new member or candidate)', H: 'New filer report' };
const iso = (mdy: string) => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/.exec(mdy ?? ''); if (!m) return null; const y = +m[3] < 100 ? +m[3] + 2000 : +m[3], d = new Date(Date.UTC(y, +m[1] - 1, +m[2])); return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? d.toISOString().slice(0, 10) : null };
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export function parseIndex(xml: string, year: number) {
  const out: { doc_id: string; type: string; type_name: string; last: string; first: string; name: string; district: string; year: number; filed: string | null; url: string }[] = [];
  for (const m of xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)) {
    const f: Record<string, string> = {}; for (const t of m[1].matchAll(/<(\w+)>([^<]*)<\/\1>|<(\w+)\s*\/>/g)) f[t[1] ?? t[3]] = unesc((t[2] ?? '').trim());
    const doc = f.DocID ?? '', kind = f.FilingType ?? '', y = Number(f.Year) || year;
    out.push({ doc_id: doc, type: kind, type_name: TYPES[kind] ?? kind, last: f.Last ?? '', first: f.First ?? '', name: [f.Prefix, f.First, f.Last, f.Suffix].filter(Boolean).join(' '), district: f.StateDst ?? '', year: y, filed: iso(f.FilingDate ?? ''), url: `${BASE}${kind === 'P' ? 'ptr-pdfs' : 'financial-pdfs'}/${y}/${doc}.pdf` });
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((a, b) => cmp(b.filed ?? '', a.filed ?? '') || cmp(b.doc_id, a.doc_id));
}
const yearOf = (v: string | null) => { const y = Number(v ?? new Date().getUTCFullYear()); if (!Number.isInteger(y) || y < 2008 || y > new Date().getUTCFullYear()) throw bad('year: 2008 to this year'); return y };
export const index = (year: number) => cached(`idx|${year}`, 30 * 60_000, async () => parseIndex(unzipXml(await bytes(`${BASE}financial-pdfs/${year}FD.zip`)).toString('utf8'), year));
const pdftotext = () => [process.env.CT_PDFTOTEXT, 'pdftotext', 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe'].filter((x): x is string => !!x && (x === 'pdftotext' || existsSync(x)));
function toText(pdf: Buffer): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'ct-ptr-')), f = join(dir, 'r.pdf'); writeFileSync(f, pdf);
  const tryOne = (exes: string[]): Promise<string | null> => !exes.length ? Promise.resolve(null) : new Promise(res => execFile(exes[0], ['-layout', f, '-'], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }, (err, out) => (err ? res(tryOne(exes.slice(1))) : res(out))));
  return tryOne(pdftotext()).finally(() => rmSync(dir, { recursive: true, force: true }));
}
/** A PTR's text (null when pdftotext is not installed) and its PDF link. */
export const report = (year: number, doc: string) => {
  if (!/^\d{5,12}$/.test(doc)) throw bad('doc: a numeric document id');
  const url = `${BASE}ptr-pdfs/${year}/${doc}.pdf`;
  return cached(`ptr|${year}|${doc}`, 24 * 3600_000, async () => { const b = await bytes(url); if (b.subarray(0, 4).toString() !== '%PDF') throw new HttpError(502, `doc ${doc} did not come back as a PDF`); return { url, text: await toText(b) } });
};
route('GET', '/api/ptr/index', c => index(yearOf(c.url.searchParams.get('year'))));
route('GET', '/api/ptr/report', c => report(yearOf(c.url.searchParams.get('year')), c.url.searchParams.get('doc') ?? ''));
