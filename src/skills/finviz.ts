// finviz-screener: build a FinViz screener URL from a plain request or from filter codes. The original lets a
// language model pick codes from its reference; here the reference table (finviz-filters.ts, extracted from the
// skill's filter reference) is matched by keyword, the longest phrases first, and codes are validated the same way.
import type { Skill } from './types.ts';
import FILTERS from './finviz-filters.ts';

type Row = [code: string, meaning: string, section: string, keywords: string[], signal: boolean];
const ROWS = FILTERS as Row[];
const VIEWS: Record<string, string> = { overview: '111', valuation: '121', ownership: '131', performance: '141', custom: '152', financial: '161', technical: '171' };
const PREFIXES = new Set(['an_', 'cap_', 'earningsdate_', 'etf_', 'exch_', 'fa_', 'geo_', 'idx_', 'ind_', 'ipodate_', 'news_', 'sec_', 'sh_', 'subtheme_', 'ta_', 'targetprice_', 'theme_']);
// A few Persian phrases for the commonest filters (the reference has English and Japanese keywords).
const FA: [string, string][] = [['کوچک', 'cap_small'], ['متوسط', 'cap_mid'], ['بزرگ', 'cap_large'], ['خیلی بزرگ', 'cap_mega'], ['فناوری', 'sec_technology'], ['تکنولوژی', 'sec_technology'], ['انرژی', 'sec_energy'], ['مالی', 'sec_financial'], ['بانک', 'sec_financial'], ['سلامت', 'sec_healthcare'], ['دارو', 'sec_healthcare'], ['صنعتی', 'sec_industrials'], ['املاک', 'sec_realestate'], ['آمریکا', 'geo_usa'], ['اس اند پی', 'idx_sp500'], ['سقف جدید', 'ta_newhigh'], ['کف جدید', 'ta_newlow'], ['اشباع فروش', 'ta_oversold'], ['اشباع خرید', 'ta_overbought'], ['حجم غیرعادی', 'ta_unusualvolume']];

export function validate(tokens: string[]) {
  const ok: string[] = [], warn: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('theme_') || t.startsWith('subtheme_')) throw new Error(`'${t}': use the themes field`);
    if (!/^[a-z0-9_.-]+$/.test(t)) throw new Error(`Invalid filter token '${t}': only lowercase letters, digits, underscores, dots and dashes`);
    const p = t.includes('_') ? `${t.split('_')[0]}_` : ''; if (p && !PREFIXES.has(p)) warn.push(`unknown prefix '${p}' in '${t}'`);
    if (!ok.includes(t)) ok.push(t);
  }
  return { ok, warn };
}
export const slugs = (raw: string, prefix: string) => { const out = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => s.startsWith(`${prefix}_`) ? s.slice(prefix.length + 1) : s); for (const s of out) if (!/^[a-z0-9]+$/.test(s)) throw new Error(`Invalid ${prefix} slug '${s}'`); return [...new Set(out)] };
export function buildUrl(filters: string[], { elite = false, view = 'overview', order = null as string | null, themes = [] as string[], subthemes = [] as string[], signal = null as string | null } = {}) {
  if (order && !/^-?[a-z0-9_]+$/.test(order)) throw new Error(`Invalid order '${order}'`);
  const parts = [...(themes.length ? [`theme_${themes.join('|')}`] : []), ...(subthemes.length ? [`subtheme_${subthemes.join('|')}`] : []), ...filters];
  let url = `https://${elite ? 'elite.' : ''}finviz.com/screener.ashx?v=${VIEWS[view] ?? '111'}&f=${encodeURIComponent(parts.join(',')).replace(/%2C/g, ',')}`;
  if (order) url += `&o=${order}`;
  if (signal) url += `&s=${signal}`;
  return url;
}
/** Filter codes a request mentions: reference keywords (longest first, each phrase used once), then Persian aliases. */
export function fromText(text: string) {
  let t = ` ${text.toLowerCase().replace(/[,.;]/g, ' ')} `; const codes: string[] = [], signals: string[] = [];
  const kw = ROWS.flatMap(r => r[3].map(k => [k, r] as const)).filter(([k]) => k.length >= 3).sort((a, b) => b[0].length - a[0].length);
  for (const [k, r] of kw) { const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`); if (re.test(t)) { (r[4] ? signals : codes).push(r[0]); t = t.replace(re, '$1 ') } }
  for (const [k, c] of [...FA].sort((a, b) => b[0].length - a[0].length)) if (t.includes(k)) { codes.push(c); t = t.split(k).join(' ') }
  return { codes: [...new Set(codes)], signals: [...new Set(signals)] };
}

export const finvizSkill: Skill = {
  id: 'finviz-screener', name: 'FinViz screener link', group: 'Screeners', from: 'finviz-screener',
  desc: 'Turn a request ("oversold large caps in technology near new lows") or FinViz filter codes into a FinViz screener link, with view and sort order. Keywords come from the skill\'s filter reference; you can always add exact codes.',
  inputs: [
    { key: 'text', label: 'Request (English, or common Persian terms)', type: 'text', default: 'small cap technology oversold', optional: true },
    { key: 'codes', label: 'Extra filter codes', type: 'text', optional: true, hint: 'e.g. fa_div_o3,fa_pe_u20,ta_rsi_os30' },
    { key: 'themes', label: 'Themes', type: 'text', optional: true, hint: 'e.g. artificialintelligence,cybersecurity' },
    { key: 'view', label: 'View', type: 'select', options: Object.keys(VIEWS), default: 'overview' },
    { key: 'order', label: 'Sort', type: 'text', optional: true, hint: 'e.g. -marketcap, -dividendyield' },
    { key: 'elite', label: 'FINVIZ Elite', type: 'bool', default: false },
  ],
  run(v) {
    const found = fromText(String(v.text ?? '')), extra = String(v.codes ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const { ok, warn } = validate([...found.codes, ...extra]), themes = String(v.themes ?? '').trim() ? slugs(String(v.themes), 'theme') : [];
    if (!ok.length && !themes.length && !found.signals.length) throw new Error('No filter recognised — add codes (see the table below for the vocabulary) or rephrase');
    const url = buildUrl(ok, { elite: v.elite === true, view: String(v.view || 'overview'), order: String(v.order ?? '').trim() || null, themes, signal: found.signals[0] ?? null });
    const meaning = new Map(ROWS.map(r => [r[0], r[1]]));
    return {
      verdict: { label: `${ok.length + themes.length + (found.signals[0] ? 1 : 0)} filters`, tone: 'up', detail: url },
      tables: [{ title: 'Filters used', cols: ['Code', 'Meaning'], rows: [...ok.map(c => [c, meaning.get(c) ?? '(your code)']), ...themes.map(t => [`theme_${t}`, 'theme']), ...found.signals.slice(0, 1).map(s => [`s=${s}`, meaning.get(s) ?? 'signal'])] }],
      links: [{ label: 'Open on FinViz', url }],
      notes: [...warn, ...(found.signals.length > 1 ? [`FinViz takes one signal; using ${found.signals[0]}.`] : []), 'Check the filters on the FinViz page; keyword matching can miss nuance.'],
    };
  },
};
