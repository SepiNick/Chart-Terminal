// One-click starting points for order flow, so a new user does not have to learn ten switches before seeing anything
// useful (the learning curve is the standard complaint about ATAS and Bookmap). Each preset is a plain patch of OFCfg
// with a one-line "what do I look at" hint.
import type { OFCfg } from './layer.ts';

export interface OfPreset { id: string; label: string; hint: string; cfg: Partial<OFCfg> }
export const OF_PRESETS: OfPreset[] = [
  { id: 'tape', label: 'Who is pushing the price?', hint: 'Delta in each candle, cumulative delta below, big trades as bubbles. Price rising while delta falls = the push is weak.',
    cfg: { footprint: 'delta', cvd: true, delta: true, bubbles: true, heatmap: false, tpo: false, vprofile: false, absorption: false, cluster: 'off' } },
  { id: 'imbalance', label: 'Imbalances and absorption', hint: 'Bid × ask numbers per price; a diagonal ratio of 3 or more is marked, and absorption (heavy volume that does not move price) is flagged.',
    cfg: { footprint: 'bidask', ratio: 3, absorption: true, cvd: false, delta: true, bubbles: false, heatmap: false, tpo: false, vprofile: false, cluster: 'off' } },
  { id: 'liquidity', label: 'Where are the resting orders?', hint: 'Order-book heatmap of the last hours with big trades on top. Bright bands are walls that price may stop at or pull toward.',
    cfg: { footprint: 'off', heatmap: true, bubbles: true, cvd: false, delta: false, tpo: false, vprofile: false, absorption: false, cluster: 'off' } },
  { id: 'auction', label: 'Value and structure of the day', hint: 'Volume profile and market profile per session: the point of control, the value area, thin spots price tends to cross quickly.',
    cfg: { footprint: 'off', heatmap: false, bubbles: false, cvd: false, delta: false, tpo: true, vprofile: true, absorption: false, cluster: 'off' } },
  { id: 'off', label: 'Turn everything off', hint: 'Back to a plain price chart.',
    cfg: { footprint: 'off', heatmap: false, bubbles: false, cvd: false, delta: false, tpo: false, vprofile: false, absorption: false, cluster: 'off', clusterAlert: false } },
];

/** A preset's own switches (what it turns on), so several presets can be on together instead of replacing each other. */
const onKeys = (p: OfPreset) => Object.entries(p.cfg).filter(([k, v]) => k === 'ratio' || v === true || (k === 'footprint' && v !== 'off'));
const isOn = (k: string, v: unknown) => (k === 'ratio' ? true : v === true || (k === 'footprint' && v !== 'off'));
/** True when every switch the preset turns on is on now ('off' is a reset, never "on"). */
export const presetActive = (of: Partial<OFCfg>, p: OfPreset) => p.id !== 'off' && onKeys(p).every(([k, v]) => k === 'ratio' || (of as Record<string, unknown>)[k] === v);
/** Clicking a preset: on → switch only its own features off; off → switch only its own on, leaving the others alone. 'off' resets all. */
export function presetToggle(of: Partial<OFCfg>, p: OfPreset): Partial<OFCfg> {
  if (p.id === 'off') return p.cfg;
  if (!presetActive(of, p)) return Object.fromEntries(onKeys(p)) as Partial<OFCfg>;
  return Object.fromEntries(onKeys(p).filter(([k, v]) => isOn(k, v) && k !== 'ratio').map(([k, v]) => [k, typeof v === 'boolean' ? false : 'off'])) as Partial<OFCfg>;
}
