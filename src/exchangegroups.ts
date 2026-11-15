// The exchange picker in symbol search, grouped: perpetuals, spot, brokers, forex / stocks, market data, Iran, then every other exchange.
import { CATALOG } from './providers/catalog.ts';

export const EX_GROUPS = ['Crypto perpetuals', 'Crypto spot', 'Your brokers & data keys', 'Forex, stocks, indices & commodities', 'Crypto market data', 'Iran markets', 'Other crypto exchanges'];
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function groupOf(id: string): number {
  const c = CATALOG.find(p => p.id === id)?.category;
  return c === 'perp' ? 0 : c === 'spot' ? 1 : ['oanda', 'alpaca', 'polygon', 'twelvedata', 'mt5'].includes(id) ? 2 : id === 'fx' ? 3 : id === 'cryptocap' ? 4 : ['nobitex', 'tgju', 'tse'].includes(id) ? 5 : 6;
}

/** Exchanges whose public API has no candles (a chart cannot open) or needs the owner's own keys: probed one by one, hidden from the picker. */
export const UNUSABLE = new Set(['bit2c', 'bitbns', 'bitflyer', 'blockchaincom', 'coincheck', 'coinmate', 'coinspot', 'coinone', 'independentreserve', 'latoken', 'paymium', 'zaif', 'luno', 'mudrex', 'modetrade', 'woofipro', 'btcbox', 'cex']);

export function exchangeOptions(ex: { id: string; name: string }[]): string {
  const label = (x: { id: string; name: string }) => CATALOG.find(p => p.id === x.id)?.name ?? (x.name && x.name !== x.id ? x.name : x.id);
  const seen = new Set<string>(), buckets: string[][] = EX_GROUPS.map(() => []);
  for (const x of [...ex].filter(e => !UNUSABLE.has(e.id)).sort((a, b) => label(a).localeCompare(label(b)))) if (!seen.has(x.id)) { seen.add(x.id); buckets[groupOf(x.id)].push(`<option value="${esc(x.id)}">${esc(label(x))}</option>`) }
  return '<option value="all">All exchanges</option>' + buckets.map((b, i) => (b.length ? `<optgroup label="${EX_GROUPS[i]}">${b.join('')}</optgroup>` : '')).join('');
}
