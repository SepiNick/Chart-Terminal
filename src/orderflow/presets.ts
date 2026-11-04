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
