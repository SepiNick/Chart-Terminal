// trader-pelosi: stock trades members of Congress disclose under the STOCK Act. Lists the House Clerk's Periodic
// Transaction Reports from its yearly index and reads each PTR (pdftotext -layout text) into rows — owner, asset,
// ticker, buy/sell, option strike and expiry, trade date, amount range, days to disclose — with the original's
// parser. Flags trades in stocks you hold. Public filings up to 45 days after the trade, not inside information.
import type { Ctx, Skill } from './types.ts';

export interface IndexRow { doc_id: string; type: string; type_name: string; last: string; first: string; name: string; district: string; year: number; filed: string | null; url: string }
const TXN_TYPES: Record<string, string> = { P: 'purchase', S: 'sale', 'S (partial)': 'partial sale', E: 'exchange' }, OWNERS: Record<string, string> = { SP: 'spouse', JT: 'joint', DC: 'dependent child', '': 'self' };
const iso = (mdy: string) => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/.exec(mdy ?? ''); if (!m) return null; const y = +m[3] < 100 ? +m[3] + 2000 : +m[3], d = new Date(Date.UTC(y, +m[1] - 1, +m[2])); return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? d.toISOString().slice(0, 10) : null };
export function memberMatch(r: IndexRow, member: string) {
  const m = (member ?? '').trim().toLowerCase(); if (!m) return true;
  let last: string, first: string;
  if (m.includes(',')) [last, first] = m.split(/,(.*)/s).map(x => (x ?? '').trim()) as [string, string]; else { const p = m.split(/\s+/); last = p.at(-1)!; first = p.slice(0, -1).join(' ') }
  return r.last.toLowerCase() === last && (!first || r.first.toLowerCase().startsWith(first));
}
const TXN = /^\s*(?:(?<owner>SP|JT|DC)\s+)?(?<asset>.*?)\s+(?<type>S \(partial\)|P|S|E)\s+(?<date>\d{2}\/\d{2}\/\d{4})\s+(?<notified>\d{2}\/\d{2}\/\d{4})\s+(?<amount>\S.*?)\s*$/;
const LABELS: [string, RegExp][] = [['status', /^\s*F(?:ILING)?\s+S(?:TATUS)?\s*:\s*(.*)$/i], ['description', /^\s*D(?:ESCRIPTION)?\s*:\s*(.*)$/i], ['account', /^\s*S(?:UBHOLDING)?\s+O(?:F)?\s*:\s*(.*)$/i], ['location', /^\s*L(?:OCATION)?\s*:\s*(.*)$/i]];
const PAGE_HEADER = /^\s*(ID\s+Owner\s+Asset|Type\s+Date\b|Type$|Date$|Gains >$|\$200\?$)/i, END = /^\s*(\* For the complete|I CERTIFY|Digitally Signed|Filing ID #)/i;
const OPTION = /([\d,]+)\s+(call|put)\s+options?\b.*?strike price of \$([\d,.]+).*?expiration date of (\d{1,2}\/\d{1,2}\/\d{2,4})/is, SHARES = /(?:purchased|sold|bought)\s+([\d,]+)\s+shares/i;
export interface Txn { owner: string; owner_name: string; asset: string; ticker: string | null; asset_type: string | null; type: string; type_name: string; date: string | null; notified: string | null; amount: string; amount_low: number | null; amount_high: number | null; status: string | null; account: string | null; description: string | null; option?: { contracts: number; kind: string; strike: number; expires: string | null; exercised: boolean }; shares?: number; days_to_disclose?: number; late?: boolean }
const ws = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
function finish(r: Record<string, unknown>, filed: string | null): Txn {
  const asset = ws(String(r._asset)); delete r._asset;
  const tick = [...asset.matchAll(/\(([A-Z][A-Z0-9.\-/]{0,9})\)/g)].map(m => m[1]), code = [...asset.matchAll(/\[([A-Z]{2})\]/g)].map(m => m[1]);
  let name = asset.replace(/\s*\[[A-Z]{2}\]/g, ''); if (tick.length) name = name.split(new RegExp(`\\s*\\(${tick.at(-1)!.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}\\)`)).join('');
  const t = r as unknown as Txn; t.ticker = tick.at(-1) ?? null; t.asset_type = code.at(-1) ?? null; t.asset = name.replace(/^[ -]+|[ -]+$/g, '');
  t.amount = ws(t.amount); const nums = [...t.amount.matchAll(/\$([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, ''))); t.amount_low = nums[0] ?? null; t.amount_high = nums[1] ?? null;
  t.description = ws(String(r.description ?? '')) || null;
  const o = OPTION.exec(t.description ?? ''); if (o) t.option = { contracts: Number(o[1].replace(/,/g, '')), kind: o[2].toLowerCase(), strike: Number(o[3].replace(/,/g, '')), expires: iso(o[4]), exercised: /^\s*exercised\b/i.test(t.description!) };
  const sh = SHARES.exec(t.description ?? ''); if (sh) t.shares = Number(sh[1].replace(/,/g, ''));
  if (filed && t.date) { t.days_to_disclose = Math.round((Date.parse(filed) - Date.parse(t.date)) / 864e5); t.late = t.days_to_disclose > 45 }
  return t;
}
/** The original's parse_ptr_text on `pdftotext -layout` output. */
export function parsePtr(text: string, filed: string | null = null) {
  const head = { name: null as string | null, status: null as string | null, district: null as string | null, doc_id: null as string | null, filed, rows: [] as Txn[] }, rows: Record<string, unknown>[] = [];
  let cur: Record<string, unknown> | null = null, mode: string | null = null, open = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/\s+$/, ''), s = line.trim(); let m: RegExpExecArray | null;
    if ((m = /^Name:\s+(.*)$/.exec(s)) && !head.name) { head.name = m[1].trim(); continue }
    if ((m = /^Status:\s+(.*)$/.exec(s)) && !head.status) { head.status = m[1].trim(); continue }
    if ((m = /^State\/District:\s*(\S+)/.exec(s))) { head.district = m[1]; continue }
    if ((m = /Filing ID #(\d+)/.exec(s))) { head.doc_id = m[1]; continue }
    if ((m = /^Digitally Signed:.*?,\s*(\d{2}\/\d{2}\/\d{4})/.exec(s))) { head.filed = head.filed || iso(m[1]); continue }
    const t = TXN.exec(line);
    if (t && iso(t.groups!.date)) {
      if (cur) rows.push(cur);
      const ow = t.groups!.owner ?? '';
      cur = { owner: ow, owner_name: OWNERS[ow] ?? ow, _asset: t.groups!.asset, type: t.groups!.type, type_name: TXN_TYPES[t.groups!.type] ?? t.groups!.type, date: iso(t.groups!.date), notified: iso(t.groups!.notified), amount: t.groups!.amount, status: null, account: null };
      open = String(cur.amount).endsWith('-'); mode = 'asset'; continue;
    }
    if (!cur) continue;
    if (!s) { if (mode === 'description' || mode === 'asset') mode = mode === 'description' || String(cur._asset).includes('[') ? 'labels' : mode; continue }
    if (PAGE_HEADER.test(s)) continue;
    if (END.test(s)) { mode = 'labels'; continue }
    const lab = LABELS.find(([, rx]) => rx.test(line));
    if (lab) { const v = lab[1].exec(line)![1].trim(); if (lab[0] === 'description') { cur.description = v; mode = 'description' } else { if (lab[0] !== 'location') cur[lab[0]] = v; mode = 'labels' } continue }
    if (mode === 'asset') { const parts = s.split(/\s{2,}/); if (open && /^\$[\d,]+$/.test(parts.at(-1)!)) { cur.amount = `${cur.amount} ${parts.pop()}`; open = false } if (parts.length && parts[0]) cur._asset = `${cur._asset} ${parts.join(' ')}` }
    else if (mode === 'description') cur.description = `${cur.description ?? ''} ${s}`;
  }
  if (cur) rows.push(cur);
  head.rows = rows.map(r => finish(r, head.filed));
  return head;
}
function describe(r: Txn) {
  let what = r.asset + (r.ticker ? ` (${r.ticker})` : '');
  if (r.option) what += `: ${r.option.exercised ? 'exercised ' : ''}${r.option.contracts} ${r.option.kind} options, $${r.option.strike} strike, expires ${r.option.expires}`; else if (r.shares) what += `: ${r.shares.toLocaleString('en-US')} shares`;
  return what;
}

export const pelosiSkill: Skill = {
  id: 'trader-pelosi', name: 'Congress trades (House PTRs)', group: 'Fundamentals', from: 'trader-pelosi',
  desc: 'Stock trades members of Congress disclose under the STOCK Act: the House Clerk\'s Periodic Transaction Reports for a member (Pelosi by default) or everyone, read into rows — owner, stock and ticker, buy or sell, options, trade date, amount range and days to disclose — flagging stocks you hold. Public filings, up to 45 days late.',
  inputs: [{ key: 'member', label: 'Member (last name or "First Last"; empty = all)', type: 'text', optional: true, default: 'Pelosi' }, { key: 'reports', label: 'Reports to read', type: 'number', default: 5 }, { key: 'year', label: 'Year', type: 'number', default: new Date().getUTCFullYear() }],
  async run(v, ctx: Ctx) {
    const year = Number(v.year) || new Date().getUTCFullYear(), member = String(v.member ?? '').trim();
    const idx = (await ctx.json<IndexRow[]>(`/api/ptr/index?year=${year}`)).filter(r => r.type === 'P' && (!member || memberMatch(r, member))), pick = idx.slice(0, Math.max(1, Math.min(30, Number(v.reports) || 5)));
    const held = new Set(ctx.account().positions.map(p => p.sym.replace(/^FX:/, '').toUpperCase())), rows: (string | number | null)[][] = [], unread: { label: string; url: string }[] = [];
    for (const f of pick) {
      const r = await ctx.json<{ url: string; text: string | null }>(`/api/ptr/report?year=${f.year}&doc=${f.doc_id}`).catch(() => null);
      const rep = r?.text ? parsePtr(r.text, f.filed) : null;
      if (!rep || !rep.rows.length) { unread.push({ label: `${f.name}, PTR ${f.doc_id} filed ${f.filed} (${r && !r.text ? 'pdftotext not installed' : 'scanned or unreadable'}: open the PDF)`, url: f.url }); continue }
      for (const t of rep.rows) rows.push([f.filed, f.name, t.owner_name, t.type_name, describe(t), t.ticker ?? '–', t.date ?? '–', t.amount, t.days_to_disclose ?? '–', [t.late ? 'LATE' : '', t.ticker && held.has(t.ticker) ? 'you hold it' : ''].filter(Boolean).join(', ')]);
    }
    return {
      verdict: { label: `${rows.length} trades in ${pick.length - unread.length} reports`, tone: 'muted', detail: `${idx.length} PTRs filed in ${year}${member ? ` by ${member}` : ''}.` },
      tables: [{ title: 'Disclosed trades', cols: ['Filed', 'Member', 'Owner', 'Type', 'Asset', 'Ticker', 'Traded', 'Amount', 'Days to disclose', 'Flags'], rows }, { title: 'Latest filings', cols: ['Filed', 'Member', 'District', 'Doc'], rows: idx.slice(0, 20).map(r => [r.filed, r.name, r.district, r.doc_id]) }],
      links: unread,
      notes: ['Public disclosure under the STOCK Act, filed up to 45 days after the trade (LATE = over 45). Amounts are ranges. Not inside information. Senate reports are not covered here.'],
    };
  },
};
