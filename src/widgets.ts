// Desktop widgets (Windows app only): any number of chart widgets (one coin + timeframe each) and watchlist widgets (one
// list each) that live on the desktop like a wallpaper. The Electron shell owns the windows (desktop/main.cjs, op 'widget',
// ids chart, chart2… / watch, watch2…); what each shows is in the device-local `widgets` key, which a widget page picks up
// through the `storage` event.
import { store, toast } from './store.ts';
import { showMenu, type MenuItem } from './menu.ts';
import { isExpr } from './symmath.ts';
import { TFS } from './data.ts';

type Type = 'chart' | 'watch';
interface WCfg { sym?: string; tf?: string; list?: string }
interface WState { type: Type; open: boolean; locked: boolean }
interface Desk { win?(op: string, arg?: unknown): Promise<unknown> }
const desk = (globalThis as unknown as { ctDesktop?: Desk }).ctDesktop;
export const canWidget = typeof desk?.win === 'function';
const call = (arg: object) => desk!.win!('widget', arg);
const state = async () => ((await call({ op: 'state' }).catch(() => null)) ?? {}) as Record<string, WState>;
const cfgs = () => store.get<Record<string, WCfg>>('widgets', {});
const cfgOf = (id: string): WCfg => cfgs()[id] ?? (id === 'chart' ? store.get<WCfg>('widget', {}) : {});
const patch = (id: string, c: WCfg) => store.set('widgets', { ...cfgs(), [id]: { ...cfgOf(id), ...c } });

/** A new widget: the shell picks a free id and opens it (unlocked the first time, for sizing). */
async function create(type: Type, c: WCfg): Promise<boolean> {
  const id = await call({ op: 'new', type });
  if (typeof id !== 'string') return false;
  store.set('widgets', { ...cfgs(), [id]: c });
  await call({ op: 'open', id });
  return true;
}
/** Put a coin and timeframe on a new chart widget. Several can exist side by side. */
export async function setChartWidget(sym: string, tf: string) {
  if (!canWidget || !sym || isExpr(sym)) return void toast('A widget needs a single symbol');
  toast((await create('chart', { sym, tf })) ? `${sym} ${tf} added as a chart widget` : 'Could not add the widget');
}
export async function setListWidget(list: string, name: string) {
  if (!canWidget) return;
  toast((await create('watch', { list })) ? `"${name}" added as a watchlist widget` : 'Could not add the widget');
}
/** Row for the chart and the watchlist-symbol right-click menus. */
export const widgetItems = (sym: string, tf: string): MenuItem[] => canWidget ? [{ sep: true }, { label: 'Set as widget', icon: '🧩', action: () => void setChartWidget(sym, tf) }] : [];
/** Row for a watchlist tab's right-click menu. */
export const listWidgetItems = (list: string, name: string): MenuItem[] => canWidget ? [{ sep: true }, { label: 'Add to desktop widgets', icon: '🧩', action: () => void setListWidget(list, name) }] : [];

/** Widgets menu: add, and per widget: coin / timeframe / list, move & resize (unlock) / lock, remove. */
export async function widgetsMenu(x: number, y: number, cur: { sym: string; tf: string }, lists: { id: string; name: string }[]) {
  if (!canWidget) return;
  const st = await state(), ids = Object.keys(st).sort();
  const one = (id: string): MenuItem => {
    const s = st[id], c = cfgOf(id), isChart = s.type === 'chart', common: MenuItem[] = [
      { label: 'Move / resize', disabled: !s.open || !s.locked, action: () => void call({ op: 'unlock', id }) },
      { label: 'Lock in place', disabled: !s.open || s.locked, action: () => void call({ op: 'lock', id }) },
      { label: 'Remove', action: () => { const all = cfgs(); delete all[id]; store.set('widgets', all); void call({ op: 'close', id }) } },
    ];
    return isChart ? { label: `Chart · ${c.sym ?? 'BTCUSDT'} ${c.tf ?? '1h'}`, sub: [
      { label: 'Change coin…', action: () => { const v = prompt('Symbol for this widget', c.sym ?? cur.sym)?.trim().toUpperCase(); if (v && !isExpr(v)) patch(id, { sym: v }) } },
      { label: 'Timeframe', hint: c.tf ?? '1h', sub: TFS.map(t => ({ label: t, checked: (c.tf ?? '1h') === t, action: () => patch(id, { tf: t }) })) },
      ...common] }
      : { label: `Watchlist · ${lists.find(l => l.id === c.list)?.name ?? 'active list'}`, sub: [
      { label: 'List', sub: [{ label: 'Follow the active list', checked: !c.list, action: () => patch(id, { list: '' }) }, ...lists.map(l => ({ label: l.name, checked: c.list === l.id, action: () => patch(id, { list: l.id }) }))] },
      ...common] };
  };
  showMenu(x, y, [
    { label: `New chart widget (${cur.sym} ${cur.tf})`, icon: '＋', action: () => void setChartWidget(cur.sym, cur.tf) },
    { label: 'New watchlist widget (active list)', icon: '＋', action: () => void create('watch', {}).then(ok => ok || toast('Could not add the widget')) },
    ...(ids.length ? [{ sep: true } as MenuItem, { head: 'Your widgets' } as MenuItem, ...ids.map(one)] : []),
  ]);
}
