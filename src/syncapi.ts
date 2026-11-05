// Server routes for atomic multi-key writes and restore points (design §4.4-4.5). Isolated here so a different server shape is a local change.
import { api } from './sync.ts';
export interface Write { key: string; value: unknown | null; baseRev: number }
/** Thrown when another device changed a key meanwhile (nothing, or on the old-server fallback only part, was written). */
export class Conflict extends Error {}
const status = (e: unknown) => (e as { status?: number }).status;
/** One transaction on servers with POST /api/state/batch; older servers get one PUT/DELETE per key (not atomic). */
export async function writeBatch(writes: Write[]): Promise<void> {
  if (!writes.length) return;
  try { await api('/api/state/batch', { method: 'POST', body: { writes } }); return }
  catch (e) { if (status(e) === 409) throw new Conflict((e as Error).message); if (status(e) !== 404 && status(e) !== 405) throw e }
  for (const w of writes) try {
    if (w.value === null) await api(`/api/state/${w.key}`, { method: 'DELETE' });
    else await api(`/api/state/${w.key}`, { method: 'PUT', body: { value: w.value, baseRev: w.baseRev } });
  } catch (e) { if (status(e) === 409) throw new Conflict((e as Error).message); throw e }
}
export interface RestoreRow { id: string | number; at: number; label: string }
export const createRestore = (label: string, values: Record<string, unknown>) => api<{ id: string | number }>('/api/restore', { body: { label, keys: values } });
export const listRestores = () => api<RestoreRow[]>('/api/restore');
export const getRestore = (id: string | number) => api<{ keys: Record<string, unknown> }>(`/api/restore/${encodeURIComponent(String(id))}`).then(r => r.keys);
export const deleteRestore = (id: string | number) => api(`/api/restore/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
