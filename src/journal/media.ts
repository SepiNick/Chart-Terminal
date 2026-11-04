// Pictures and voice notes for journal entries. Server mode: stored on the server (/api/media); offline, or when an
// upload can't reach the server, kept in this browser's IndexedDB and uploaded at the next server-mode start.
import { serverMode } from '../sync.ts';
import { serverFetch } from '../servers.ts';

const DB = 'ct-journal-media', STORE = 'blobs';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error) };
  }));
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(d => new Promise<T>((res, rej) => { const q = fn(d.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) }));
}
const localBlob = (id: string) => tx<Blob | undefined>('readonly', s => s.get(id)).catch(() => undefined);
/** POST a blob to the server → its new id. Errors carry `.status` when the server answered. */
async function uploadBlob(blob: Blob): Promise<string> {
  const r = await serverFetch('/api/media', { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
  const j = await r.json().catch(() => ({})) as { id?: string; error?: string };
  if (!r.ok || !j.id) throw Object.assign(Error(j.error ?? `Upload failed (${r.status})`), { status: r.status });
  return j.id;
}
export async function putMedia(blob: Blob): Promise<string> {
  if (serverMode) try { return await uploadBlob(blob) } catch (e) { if ((e as { status?: number }).status) throw e }   // unreachable: keep it here for now
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  try { await tx('readwrite', s => s.put(blob, id)) } catch { throw Error('Pictures and voice notes need browser storage, which is unavailable or full on this device') }
  return id;
}
const urls = new Map<string, string>();
/** URL for a stored picture / voice note (this browser's copy first, then the server). */
export async function mediaUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const b = await localBlob(id);
  if (!b) return serverMode ? `/api/media/${encodeURIComponent(id)}` : null;
  const u = URL.createObjectURL(b); urls.set(id, u);
  return u;
}
export async function delMedia(id: string) {
  await tx('readwrite', s => s.delete(id)).catch(() => {});
  const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id) }
  if (serverMode) await serverFetch(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

type MediaHolder = { trades?: { media?: { id: string }[] }[] };
/** Media ids a journal refers to. */
export const mediaIdsOf = (j: MediaHolder | null | undefined) => (j?.trades ?? []).flatMap(t => (t.media ?? []).map(m => m.id));
/** Replace media ids in place (old → new); returns whether anything changed. */
export function rewriteMediaIds(j: MediaHolder | null | undefined, map: Map<string, string>): boolean {
  let n = 0;
  for (const t of j?.trades ?? []) for (const m of t.media ?? []) { const id = map.get(m.id); if (id) { m.id = id; n++ } }
  return n > 0;
}
/**
 * Upload the blobs this browser still holds for the journal in localStorage (the old IndexedDB store, or pictures taken
 * while the server was unreachable), point the journal at the new ids and drop the local copies.
 * Returns the rewritten journal, or null when nothing changed. The caller sends it to the server.
 */
export async function uploadLocalMedia(onProgress?: (done: number, total: number) => void): Promise<unknown | null> {
  let j: MediaHolder | null = null;
  try { j = JSON.parse(localStorage.getItem('ct.journal') ?? 'null') } catch {}
  if (typeof indexedDB === 'undefined') return null;
  const map = new Map<string, string>(), ids = mediaIdsOf(j);
  for (const [i, id] of ids.entries()) {
    onProgress?.(i, ids.length);
    const b = await localBlob(id); if (!b) continue;
    try { map.set(id, await uploadBlob(b)) } catch { /* stays local; retried next start */ }
  }
  if (!rewriteMediaIds(j, map)) return null;
  try { localStorage.setItem('ct.journal', JSON.stringify(j)) } catch { return null }   // keep the local blobs until the journal points elsewhere
  for (const id of map.keys()) await tx('readwrite', s => s.delete(id)).catch(() => {});
  return j;
}

/** Shrink an image to at most `max` px wide as JPEG (screenshots and photos). */
export async function shrink(src: Blob | HTMLCanvasElement, max = 1280): Promise<Blob> {
  const img = src instanceof HTMLCanvasElement ? src : await createImageBitmap(src);
  const k = Math.min(1, max / img.width), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.8));
}

/** Microphone recording; resolves to an audio blob when `stop()` is called. */
export async function record(): Promise<{ stop: () => Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream), parts: Blob[] = [];
  rec.ondataavailable = e => parts.push(e.data);
  rec.start();
  return { stop: () => new Promise(res => { rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(parts, { type: rec.mimeType || 'audio/webm' })) }; rec.stop() }) };
}
