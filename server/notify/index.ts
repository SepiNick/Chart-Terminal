// [agent: notify] Notification dispatcher. See docs/phase5-contracts.md §4. Stub: popup only.
import { broadcast } from '../core/http.ts';

import type { Channel } from '../../src/alerttypes.ts';
export type { Channel };
export interface Notice {
  title: string;
  body: string;
  channels: Channel[];
  sound?: boolean;                               // popup: play the alert sound
  webhook?: { url: string; body?: string };      // per-alert webhook target and body (already rendered)
  data?: Record<string, unknown>;                // e.g. { alertId, sym, tf, price, url } — passed to popup/push
}
export interface Delivery { channel: Channel; ok: boolean; error?: string }

/** Deliver a notice on every requested channel. Never throws; returns one result per channel. */
export async function notify(n: Notice): Promise<Delivery[]> {
  const out: Delivery[] = [];
  for (const ch of n.channels) {
    if (ch === 'popup') { broadcast({ type: 'notify', title: n.title, body: n.body, sound: n.sound ?? true, data: n.data ?? {} }); out.push({ channel: ch, ok: true }) }
    else out.push({ channel: ch, ok: false, error: 'not implemented yet' });
  }
  return out;
}
