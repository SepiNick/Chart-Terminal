// Screener conditions in plain Persian or English, without a language model (ROADMAP phase 12): a small fixed grammar
//   <field> <operator> <value> [and|or <field> <operator> <value> …]
// e.g. "RSI زیر ۳۰ و حجم بالای ۱ میلیون", "change > 5% and price above sma 50", "امتیاز خرید قوی".
// Unknown words are an error (never silently dropped) and the parsed filter is always shown back (describe()).

export type Field = 'price' | 'change' | 'volume' | 'rsi' | 'sma' | 'ema' | 'rating';
export interface Cond { field: Field; op: '>' | '<' | 'between'; value: number; value2?: number; period?: number }
export interface Query { conds: Cond[]; join: 'and' | 'or' }
export class QueryError extends Error { word: string; constructor(msg: string, word: string) { super(msg); this.word = word } }

/** Persian/Arabic digits and letters to one form; lower case; spaces around symbols. */
export function normalize(s: string): string {
  return s
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/٪/g, '%').replace(/[٫،]/g, m => (m === '٫' ? '.' : ' , '))
    .replace(/‌/g, ' ')   // ZWNJ: "میانگین‌متحرک" → two words
    .toLowerCase()
    .replace(/([<>]=?|%)/g, ' $1 ')
    .replace(/\s+/g, ' ').trim();
}

// Phrases, longest first, mapped to a token. Persian forms include common spellings.
const PHRASES: [string, string][] = [
  ['میانگین متحرک نمایی', 'F:ema'], ['میانگین نمایی', 'F:ema'], ['میانگین متحرک', 'F:sma'], ['میانگین', 'F:sma'],
  ['امتیاز تکنیکال', 'F:rating'], ['تحلیل تکنیکال', 'F:rating'], ['technical rating', 'F:rating'],
  ['بیشتر از', 'O:>'], ['بیش از', 'O:>'], ['بزرگ تر از', 'O:>'], ['بزرگتر از', 'O:>'], ['بالاتر از', 'O:>'], ['more than', 'O:>'], ['greater than', 'O:>'], ['higher than', 'O:>'],
  ['کمتر از', 'O:<'], ['کم تر از', 'O:<'], ['پایین تر از', 'O:<'], ['کوچکتر از', 'O:<'], ['less than', 'O:<'], ['lower than', 'O:<'],
  ['خرید قوی', 'R:0.5'], ['strong buy', 'R:0.5'], ['فروش قوی', 'R:-0.5'], ['strong sell', 'R:-0.5'],
];
const WORDS: Record<string, string> = {
  price: 'F:price', 'قیمت': 'F:price', close: 'F:price',
  change: 'F:change', chg: 'F:change', 'تغییر': 'F:change', 'رشد': 'F:change', 'بازده': 'F:change',
  volume: 'F:volume', vol: 'F:volume', 'حجم': 'F:volume', 'حجم معاملات': 'F:volume',
  rsi: 'F:rsi', 'آر اس آی': 'F:rsi',
  sma: 'F:sma', ma: 'F:sma', ema: 'F:ema',
  rating: 'F:rating', 'امتیاز': 'F:rating', 'سیگنال': 'F:rating',
  '>': 'O:>', '>=': 'O:>', above: 'O:>', over: 'O:>', 'بالای': 'O:>', 'بالا': 'O:>', 'بیشتر': 'O:>', 'بیش': 'O:>', 'روی': 'O:>',
  '<': 'O:<', '<=': 'O:<', below: 'O:<', under: 'O:<', 'زیر': 'O:<', 'پایین': 'O:<', 'کمتر': 'O:<',
  between: 'O:between', 'بین': 'O:between',
  and: 'J:and', '&': 'J:and', 'و': 'J:and', ',': 'J:and', or: 'J:or', 'یا': 'J:or',
  buy: 'R:0.1', 'خرید': 'R:0.1', sell: 'R:-0.1', 'فروش': 'R:-0.1', neutral: 'R:0',
  '%': 'U:1', 'درصد': 'U:1', k: 'U:1e3', 'هزار': 'U:1e3', m: 'U:1e6', 'میلیون': 'U:1e6', b: 'U:1e9', 'میلیارد': 'U:1e9',
  // filler words that carry no meaning here
  'که': '', 'از': '', 'باشد': '', 'باشه': '', 'است': '', 'هست': '', 'ارز': '', 'ارزهایی': '', 'نمادهایی': '', 'سهام': '', 'دارند': '', 'دارد': '', 'با': '',
  is: '', the: '', with: '', coins: '', symbols: '', than: '', 'روز': '', 'روزه': '', day: '', days: '', period: '', 'دوره': '', 'ی': '', 'های': '',
};

function tokens(text: string): string[] {
  let s = ` ${normalize(text)} `;
  for (const [p, t] of PHRASES) s = s.split(` ${p} `).join(` ${t} `).split(` ${p} `).join(` ${t} `);
  const out: string[] = [];
  for (const w of s.trim().split(' ')) {
    if (!w) continue;
    const m = /^(sma|ema|ma)(\d{1,3})$/.exec(w);   // "sma50"
    if (m) { out.push(m[1] === 'ema' ? 'F:ema' : 'F:sma', `N:${m[2]}`); continue }
    const n = /^(-?\d+(?:\.\d+)?)(k|m|b|%)?$/.exec(w);
    if (n) { out.push(`N:${n[1]}`); if (n[2]) out.push(WORDS[n[2]]); continue }
    if (w.includes(':')) { out.push(w); continue }
    if (w in WORDS) { if (WORDS[w]) out.push(WORDS[w]); continue }
    throw new QueryError(`Not understood: "${w}"`, w);
  }
  return out;
}

export function parseQuery(text: string): Query {
  const t = tokens(text), conds: Cond[] = [];
  let i = 0, join: 'and' | 'or' | null = null;
  const num = (): number => {
    const x = t[i];
    if (!x?.startsWith('N:')) throw new QueryError(`A number is missing after "${t[i - 1]?.slice(2) ?? ''}"`, x ?? '');
    i++;
    let v = +x.slice(2);
    if (t[i]?.startsWith('U:')) { v *= +t[i].slice(2); i++ }
    return v;
  };
  while (i < t.length) {
    const f = t[i];
    if (!f.startsWith('F:')) throw new QueryError(`Expected a field (price, change, volume, RSI, SMA/EMA, rating) at "${f.slice(2)}"`, f);
    const field = f.slice(2) as Field;
    i++;
    if (field === 'rating') {
      // "rating buy", "امتیاز خرید قوی", or a number: rating > 0.3
      if (t[i]?.startsWith('O:')) i++;
      if (t[i]?.startsWith('R:')) { const v = +t[i].slice(2); i++; conds.push(v < 0 ? { field, op: '<', value: v } : { field, op: '>', value: v }) }
      else conds.push({ field, op: '>', value: num() });
    } else if (field === 'sma' || field === 'ema') {
      // "price above sma 50" is written either way round: "sma 50 below price" is not supported, keep it simple
      throw new QueryError(`Write it as "price above ${field.toUpperCase()} 50"`, field);
    } else {
      const o = t[i];
      if (!o?.startsWith('O:')) throw new QueryError(`Expected an operator (above/below/between, بالای/زیر/بین) after ${field}`, o ?? '');
      i++;
      const op = o.slice(2) as Cond['op'];
      if (field === 'price' && (t[i] === 'F:sma' || t[i] === 'F:ema')) {
        const ma = t[i].slice(2) as Field; i++;
        conds.push({ field: ma, op: op === 'between' ? '>' : op, value: 0, period: t[i]?.startsWith('N:') ? num() : 50 });
      } else if (op === 'between') {
        const a = num();
        if (t[i] === 'J:and') i++;   // "between 2 and 8": this "and" belongs to between
        const b = num();
        conds.push({ field, op, value: Math.min(a, b), value2: Math.max(a, b) });
      } else conds.push({ field, op, value: num() });
    }
    if (i < t.length) {
      if (!t[i].startsWith('J:')) throw new QueryError(`Expected "and"/"or" (و/یا) before "${t[i].slice(2)}"`, t[i]);
      const j = t[i].slice(2) as 'and' | 'or';
      if (join && j !== join) throw new QueryError('Mixing "and" with "or" is not supported: use one of them', t[i]);
      join = j; i++;
      if (i === t.length) throw new QueryError('The condition after "and"/"or" is missing', '');
    }
  }
  if (!conds.length) throw new QueryError('Write a condition, e.g. RSI زیر ۳۰ و حجم بالای ۱ میلیون', '');
  return { conds, join: join ?? 'and' };
}

const NAMES: Record<Field, string> = { price: 'Price', change: 'Change 24h %', volume: 'Volume', rsi: 'RSI 14 (daily)', sma: 'SMA', ema: 'EMA', rating: 'Technical rating' };
export function describe(q: Query): string {
  return q.conds.map(c => {
    if (c.field === 'sma' || c.field === 'ema') return `Price ${c.op === '>' ? 'above' : 'below'} ${c.field.toUpperCase()} ${c.period} (daily)`;
    if (c.op === 'between') return `${NAMES[c.field]} between ${c.value} and ${c.value2}`;
    return `${NAMES[c.field]} ${c.op === '>' ? '>' : '<'} ${c.value}`;
  }).join(q.join === 'and' ? '  AND  ' : '  OR  ');
}
/** Needs daily bars (RSI, moving averages, rating)? Those are fetched only for rows that pass the cheap conditions. */
export const needsBars = (c: Cond) => c.field === 'rsi' || c.field === 'sma' || c.field === 'ema' || c.field === 'rating';

export interface Row { price: number; change: number; volume: number; rsi?: number | null; sma?: Record<number, number | null>; ema?: Record<number, number | null>; rating?: number | null }
/** Does one condition hold? null = its data is missing (a missing value never passes). */
export function test1(c: Cond, r: Row): boolean {
  const v = c.field === 'sma' || c.field === 'ema' ? r[c.field]?.[c.period!] : c.field === 'rsi' ? r.rsi : c.field === 'rating' ? r.rating : r[c.field];
  if (v == null || !Number.isFinite(v)) return false;
  if (c.field === 'sma' || c.field === 'ema') return c.op === '>' ? r.price > v : r.price < v;
  return c.op === 'between' ? v >= c.value && v <= c.value2! : c.op === '>' ? v > c.value : v < c.value;
}
export const matches = (q: Query, r: Row) => (q.join === 'and' ? q.conds.every(c => test1(c, r)) : q.conds.some(c => test1(c, r)));
