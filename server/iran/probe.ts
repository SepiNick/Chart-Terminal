// One tiny request per data source, with timing: what "Diagnostics" shows when a chart stays empty.
import { nobitexBars } from './nobitex.ts';
import { tgjuBars } from './tgju.ts';
import { tseBars } from './tse.ts';

export interface Probe { source: string; ok: boolean; ms: number; detail: string }
const timed = async (source: string, f: () => Promise<string>, limit = 10_000): Promise<Probe> => {
  const t0 = Date.now();
  try {
    const detail = await Promise.race([f(), new Promise<never>((_, rej) => setTimeout(() => rej(Error(`no answer in ${limit / 1000} s`)), limit))]);
    return { source, ok: true, ms: Date.now() - t0, detail };
  } catch (e) { return { source, ok: false, ms: Date.now() - t0, detail: (e as Error).message.replace(/\s+/g, ' ').slice(0, 160) } }
};
const last = (r: { bars: { close: number; time: number }[] }) => (r.bars.length ? `${r.bars.length} bars, last ${new Date(r.bars.at(-1)!.time * 1000).toISOString().slice(0, 10)}` : 'answered with no bars');

/** Probes of the sources this server serves; `extra` adds more (Yahoo, MetaTrader) from market.ts. */
export function probeIran(enabled: string[], extra: Promise<Probe>[] = []): Promise<Probe[]> {
  const p: Promise<Probe>[] = [...extra];
  if (enabled.includes('nobitex')) p.push(timed('nobitex', async () => last(await nobitexBars('USDTIRT', '1d', undefined, 3))));
  if (enabled.includes('tgju')) p.push(timed('tgju', async () => last(await tgjuBars('USD', '1d', undefined, 3))));
  if (enabled.includes('tse')) p.push(timed('tse', async () => last(await tseBars('شاخص_کل', '1d', undefined, 3))));
  return Promise.all(p);
}
export { timed };
