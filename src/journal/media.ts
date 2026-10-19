// Pictures and voice notes for journal entries, kept in IndexedDB (localStorage is too small for media).
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
export async function putMedia(blob: Blob): Promise<string> {
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await tx('readwrite', s => s.put(blob, id));
  return id;
}
const urls = new Map<string, string>();
/** Object URL for a stored blob (cached for the session). */
export async function mediaUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const b = await tx<Blob | undefined>('readonly', s => s.get(id)).catch(() => undefined);
  if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(id, u);
  return u;
}
export async function delMedia(id: string) { await tx('readwrite', s => s.delete(id)).catch(() => {}); const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id) } }

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
