// Items for the "▦ Order flow" menu (profiles, Cluster Search, absorption, Market Replay) and the Bar Replay bar's
// buttons while a Market Replay runs. Kept here so main.ts only needs a few lines.
import type { MenuItem } from '../menu.ts';
import type { ChartPane } from '../chart.ts';
import type { OFCfg } from './layer.ts';
import { replayActive, replayBack, replayControl, replayOn, replayPaused, startReplay, stopReplay } from './source.ts';
import { serverMode } from '../sync.ts';
import { toast } from '../store.ts';
import { tfSeconds } from '../data.ts';

const SPEEDS = [1, 2, 5, 10, 30, 60, 300];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const METRICS = ['off', 'volume', 'delta', 'bid', 'ask', 'trades'] as const;
const reload = (panes: ChartPane[], sym: string, tf: string) => panes.filter(x => x.cfg.symbol === sym && x.cfg.tf === tf).forEach(x => x.load());

export function ofMenu(p: ChartPane, of: OFCfg, set: (patch: Partial<OFCfg>) => void, num: (q: string, cur: number) => number | null, panes: () => ChartPane[]): MenuItem[] {
  const rp = replayActive(), cl = of.cluster ?? 'off';
  return [
    { sep: true },
    { label: 'TPO (market profile) per session', checked: !!of.tpo, action: () => set({ tpo: !of.tpo }) },
    { label: 'Volume profile per session', checked: !!of.vprofile, action: () => set({ vprofile: !of.vprofile }) },
    { label: 'Session start…', hint: `${hhmm(of.sessionStart ?? 0)} UTC`, action: () => {
      const v = prompt('Daily sessions start at (UTC, HH:MM). 13:30 = New York cash open, 20:30 = midnight in Tehran, 00:00 = UTC day', hhmm(of.sessionStart ?? 0));
      const m = v?.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (v == null) return;
      if (!m || +m[1] > 23 || +m[2] > 59) return toast('Use HH:MM, for example 13:30');
      set({ sessionStart: +m[1] * 60 + +m[2] });
    } },
    { label: 'Cluster Search', hint: cl, sub: [
      ...METRICS.map(m => ({ label: m === 'off' ? 'Off' : `By ${m}`, checked: cl === m, action: () => set({ cluster: m }) })),
      { sep: true },
      { label: 'Minimum…', hint: of.clusterMin ? String(of.clusterMin) : 'auto (top 1%)', action: () => { const v = num('Minimum value (delta: absolute value). 0 = automatic: the top 1% of the window', of.clusterMin ?? 0); if (v != null) set({ clusterMin: v }) } },
      { label: 'Maximum…', hint: of.clusterMax ? String(of.clusterMax) : 'none', action: () => { const v = num('Maximum value. 0 = no maximum', of.clusterMax ?? 0); if (v != null) set({ clusterMax: v }) } },
      { label: 'Window…', hint: `${of.clusterWindow ?? 50} bars`, action: () => { const v = num('Bars to search, counted back from the last', of.clusterWindow ?? 50); if (v) set({ clusterWindow: Math.round(v) }) } },
      { label: 'Alert on new clusters', checked: !!of.clusterAlert, action: () => set({ clusterAlert: !of.clusterAlert }) },
    ] },
    { label: 'Absorption markers', checked: !!of.absorption, action: () => set({ absorption: !of.absorption }) },
    { sep: true },
    rp ? { label: `Market replay: ${rp.sym} ${rp.tf}`, sub: [
      { label: replayPaused() ? 'Resume' : 'Pause', action: () => replayControl({ paused: !replayPaused() }) },
      ...SPEEDS.map(s => ({ label: `${s}× speed`, action: () => replayControl({ speed: s }) })),
      { label: 'Back 1 minute', action: () => void replayBack(60).then(() => reload(panes(), rp.sym, rp.tf), e => toast((e as Error).message, 6000)) },
      { label: 'Back 15 minutes', action: () => void replayBack(900).then(() => reload(panes(), rp.sym, rp.tf), e => toast((e as Error).message, 6000)) },
      { label: 'Stop replay', action: () => endReplay(panes()) },
    ] } : { label: 'Market replay (recorded trades)…', action: () => void beginReplay(p, panes) },
  ];
}

/** From the Bar Replay position when one is running, else from a typed date. */
async function beginReplay(p: ChartPane, panes: () => ChartPane[]) {
  if (!serverMode) return toast('Market replay plays the server\'s trade recording: open the app through the data server');
  let from = p.replay && !p.replay.picking ? p.bars[p.replay.idx]?.time : undefined;
  if (from == null) {
    const d = new Date(Date.now() - 3600_000), pad = (n: number) => String(n).padStart(2, '0');
    const v = prompt('Replay recorded trades from (local time, YYYY-MM-DD HH:MM)', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    if (!v) return;
    from = new Date(v.trim().replace(' ', 'T')).getTime() / 1000;
    if (!Number.isFinite(from)) return toast('Not a date');
  }
  try { await startReplay(p.cfg.symbol, p.cfg.tf, from, 10) } catch (e) { return toast((e as Error).message, 6000) }
  reload(panes(), p.cfg.symbol, p.cfg.tf);
  toast('Market replay at 10× — the replay bar controls play, speed, skip and exit');
}
function endReplay(panes: ChartPane[]) {
  const r = replayActive(); stopReplay();
  if (r) reload(panes, r.sym, r.tf);
}

/** Bar Replay buttons while a Market Replay runs on `p`; returns false when they should do their usual thing. */
export function replayButton(p: ChartPane, what: 'play' | 'speed' | 'step' | 'back' | 'exit', panes: ChartPane[], msPerBar = 1000): boolean {
  if (!replayOn(p.cfg.symbol, p.cfg.tf)) return false;
  const sec = tfSeconds(p.cfg.tf);
  if (what === 'play') replayControl({ paused: !replayPaused() });
  if (what === 'speed') replayControl({ speed: Math.max(1, Math.round((sec * 1000) / msPerBar)) });   // "one bar per X" as a clock multiplier
  if (what === 'step') replayControl({ skip: Math.max(sec, 10) });
  if (what === 'back') replayBack(Math.max(sec, 10)).then(() => reload(panes, p.cfg.symbol, p.cfg.tf), e => toast((e as Error).message, 6000));
  if (what === 'exit') endReplay(panes);
  return true;
}
export const marketReplayUi = (p: ChartPane) => (replayOn(p.cfg.symbol, p.cfg.tf) ? { open: true, playing: !replayPaused() } : null);
