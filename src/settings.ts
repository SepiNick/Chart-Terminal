// Chart settings: the model, defaults and the tabbed dialog schema (TradingView's Chart settings).
import { store, esc } from './store.ts';

export interface Settings {
  theme: 'dark' | 'light';
  // Symbol
  upColor: string; downColor: string; bodyVisible: boolean; borderVisible: boolean; wickVisible: boolean;
  colorByPrevClose: boolean; precision: string; tz: string;
  renkoBox: string; atrLength: number; reversal: number; lineBreak: number; rangeSize: number;
  // Status line
  legend: boolean; legendTitle: 'ticker' | 'description' | 'both'; barChange: boolean; legendVolume: boolean;
  indTitles: boolean; indArgs: boolean; indValues: boolean; legendBg: boolean;
  // Scales and lines
  scaleMode: 'normal' | 'log' | 'percent' | 'indexed'; invert: boolean; scaleSide: 'right' | 'left';
  lastPriceLine: boolean; lastPriceLabel: boolean; countdown: boolean; prevCloseLine: boolean;
  highLowLines: boolean; avgCloseLine: boolean; indLabels: boolean;
  marginTop: number; marginBottom: number; rightOffset: number;
  dayOfWeek: boolean; dateFormat: 'dd MMM yy' | 'yyyy-MM-dd' | 'MM/dd/yy' | 'dd.MM.yyyy'; hour12: boolean;
  // Canvas
  bgType: 'solid' | 'gradient'; bgColor: string; bgColor2: string;
  vertGrid: boolean; horzGrid: boolean; gridColor: string;
  crosshairColor: string; crosshairWidth: number; crosshairStyle: 'solid' | 'dashed' | 'dotted';
  crosshair: 'normal' | 'magnet' | 'hidden';
  watermark: boolean; scaleTextColor: string; scaleFontSize: number; separatorColor: string;
  // Trading
  tradeLines: boolean; executions: boolean; orderAlign: 'left' | 'center' | 'right'; instantOrders: boolean; buySellButtons: boolean;
  // Alerts
  alertLines: boolean; alertLineColor: string; onlyActiveAlerts: boolean; alertVolume: number; autoHideToasts: boolean;
  // Drawing behaviour
  magnet: 'off' | 'weak' | 'strong'; keepDrawing: boolean; volume: boolean;
}

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
export const DEFAULT_SETTINGS: Settings = {
  theme: dark ? 'dark' : 'light',
  upColor: '#089981', downColor: '#f23645', bodyVisible: true, borderVisible: true, wickVisible: true,
  colorByPrevClose: false, precision: 'default', tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  renkoBox: 'atr', atrLength: 14, reversal: 3, lineBreak: 3, rangeSize: 0,
  legend: true, legendTitle: 'ticker', barChange: true, legendVolume: true, indTitles: true, indArgs: true, indValues: true, legendBg: false,
  scaleMode: 'normal', invert: false, scaleSide: 'right',
  lastPriceLine: true, lastPriceLabel: true, countdown: true, prevCloseLine: false, highLowLines: false, avgCloseLine: false, indLabels: true,
  marginTop: 10, marginBottom: 8, rightOffset: 8, dayOfWeek: true, dateFormat: 'dd MMM yy', hour12: false,
  bgType: 'solid', bgColor: '', bgColor2: '', vertGrid: true, horzGrid: true, gridColor: '',
  crosshairColor: '#9598a1', crosshairWidth: 1, crosshairStyle: 'dashed', crosshair: 'normal',
  watermark: true, scaleTextColor: '', scaleFontSize: 12, separatorColor: '',
  tradeLines: true, executions: true, orderAlign: 'right', instantOrders: false, buySellButtons: true,
  alertLines: true, alertLineColor: '#ff9800', onlyActiveAlerts: true, alertVolume: 0.6, autoHideToasts: true,
  magnet: 'off', keepDrawing: false, volume: true,
};
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...store.get<Partial<Settings>>('settings', {}) });

type Kind = 'bool' | 'color' | 'number' | string[];
type Row = [keyof Settings, string, Kind, { min?: number; max?: number; step?: number }?] | string;
const TZS = ['UTC', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Istanbul', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Kolkata', 'Australia/Sydney'];
export const SETTINGS_TABS: { id: string; name: string; rows: Row[] }[] = [
  { id: 'symbol', name: 'Symbol', rows: [
    'Candles', ['upColor', 'Up color', 'color'], ['downColor', 'Down color', 'color'], ['bodyVisible', 'Body', 'bool'], ['borderVisible', 'Borders', 'bool'], ['wickVisible', 'Wick', 'bool'],
    ['colorByPrevClose', 'Color bars based on previous close', 'bool'],
    'Data modification', ['precision', 'Precision', ['default', '0', '1', '2', '3', '4', '5', '6', '7', '8']],
    ['tz', 'Timezone', [...new Set([DEFAULT_SETTINGS.tz, ...TZS])]],
    'Price-based charts', ['renkoBox', 'Renko/PnF box size (atr or a price)', ['atr', '1', '5', '10', '50', '100', '500']], ['atrLength', 'ATR length', 'number', { min: 1, max: 200 }],
    ['reversal', 'Reversal (boxes)', 'number', { min: 1, max: 10 }], ['lineBreak', 'Line break: number of lines', 'number', { min: 1, max: 10 }],
    ['rangeSize', 'Range size (0 = auto)', 'number', { min: 0, step: 0.0001 }],
  ] },
  { id: 'status', name: 'Status line', rows: [
    ['legend', 'Chart values (OHLC)', 'bool'], ['legendTitle', 'Title', ['ticker', 'description', 'both']], ['barChange', 'Bar change values', 'bool'],
    ['legendVolume', 'Volume', 'bool'], ['indTitles', 'Indicator titles', 'bool'], ['indArgs', 'Indicator arguments', 'bool'], ['indValues', 'Indicator values', 'bool'],
    ['legendBg', 'Background', 'bool'],
  ] },
  { id: 'scales', name: 'Scales and lines', rows: [
    'Price scale', ['scaleMode', 'Scale mode', ['normal', 'log', 'percent', 'indexed']], ['invert', 'Invert scale', 'bool'], ['scaleSide', 'Scale placement', ['right', 'left']],
    ['marginTop', 'Top margin %', 'number', { min: 0, max: 40 }], ['marginBottom', 'Bottom margin %', 'number', { min: 0, max: 40 }],
    'Lines', ['lastPriceLabel', 'Symbol last price label', 'bool'], ['lastPriceLine', 'Symbol last price line', 'bool'], ['countdown', 'Countdown to bar close', 'bool'],
    ['prevCloseLine', 'Previous day close line', 'bool'], ['highLowLines', 'High and low price lines', 'bool'], ['avgCloseLine', 'Average close price line', 'bool'],
    ['indLabels', 'Indicator value labels', 'bool'],
    'Time scale', ['rightOffset', 'Right margin (bars)', 'number', { min: 0, max: 200 }], ['dayOfWeek', 'Day of week on labels', 'bool'],
    ['dateFormat', 'Date format', ['dd MMM yy', 'yyyy-MM-dd', 'MM/dd/yy', 'dd.MM.yyyy']], ['hour12', '12-hour time', 'bool'],
  ] },
  { id: 'canvas', name: 'Canvas', rows: [
    'Chart basic styles', ['theme', 'Theme', ['dark', 'light']], ['bgType', 'Background', ['solid', 'gradient']], ['bgColor', 'Background color', 'color'], ['bgColor2', 'Gradient bottom color', 'color'],
    ['vertGrid', 'Vertical grid lines', 'bool'], ['horzGrid', 'Horizontal grid lines', 'bool'], ['gridColor', 'Grid color', 'color'], ['separatorColor', 'Pane separators', 'color'],
    ['crosshair', 'Crosshair mode', ['normal', 'magnet', 'hidden']], ['crosshairColor', 'Crosshair color', 'color'], ['crosshairWidth', 'Crosshair width', 'number', { min: 1, max: 4 }],
    ['crosshairStyle', 'Crosshair style', ['solid', 'dashed', 'dotted']], ['watermark', 'Watermark', 'bool'],
    'Scales', ['scaleTextColor', 'Text color', 'color'], ['scaleFontSize', 'Font size', 'number', { min: 9, max: 18 }],
  ] },
  { id: 'trading', name: 'Trading', rows: [
    ['tradeLines', 'Positions and orders', 'bool'], ['executions', 'Execution arrows', 'bool'], ['orderAlign', 'Order labels alignment', ['left', 'center', 'right']],
    ['buySellButtons', 'Buy/Sell buttons', 'bool'], ['instantOrders', 'Instant order placement', 'bool'],
  ] },
  { id: 'alerts', name: 'Alerts', rows: [
    ['alertLines', 'Alert lines', 'bool'], ['alertLineColor', 'Alert line color', 'color'], ['onlyActiveAlerts', 'Only active alerts', 'bool'],
    ['alertVolume', 'Alert volume', 'number', { min: 0, max: 1, step: 0.1 }], ['autoHideToasts', 'Auto-hide notifications after 20s', 'bool'],
  ] },
];

/** Renders the tabbed settings form; `cssVar` resolves theme colors shown for empty (theme-default) color fields. */
export function renderSettingsForm(s: Settings, tab: string, cssVar: (k: keyof Settings) => string): string {
  const t = SETTINGS_TABS.find(x => x.id === tab) ?? SETTINGS_TABS[0];
  return t.rows.map(row => {
    if (typeof row === 'string') return `<h4>${esc(row)}</h4>`;
    const [k, label, kind, lim = {}] = row, v = s[k];
    const id = `set-${k}`;
    const input = kind === 'bool' ? `<input id="${id}" type="checkbox" data-k="${k}" ${v ? 'checked' : ''}>`
      : kind === 'color' ? `<input id="${id}" type="color" data-k="${k}" value="${esc(v || cssVar(k))}">`
      : kind === 'number' ? `<input id="${id}" type="number" data-k="${k}" value="${esc(v)}" min="${lim.min ?? ''}" max="${lim.max ?? ''}" step="${lim.step ?? 1}" style="width:90px">`
      : `<select id="${id}" data-k="${k}">${kind.map(o => `<option ${o === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<label for="${id}">${esc(label)}</label>${input}`;
  }).join('');
}
export function readSettingsInput(i: HTMLInputElement | HTMLSelectElement): Partial<Settings> {
  const k = i.dataset.k as keyof Settings;
  const v = i instanceof HTMLInputElement && i.type === 'checkbox' ? i.checked : i instanceof HTMLInputElement && i.type === 'number' ? +i.value : i.value;
  return { [k]: v } as Partial<Settings>;
}
