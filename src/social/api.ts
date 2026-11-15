// Community: every HTTP call and WebSocket op lives here, so a server mismatch is a one-file fix.
import { api, onServer, onSyncStatus, wsSend } from '../sync.ts';
import { isStandalone, serverFetch, serverUrl, syncServer } from '../servers.ts';
import type { Dir } from './logic.ts';

export interface Author { name: string }
export interface Post { id: number; user: Author; ts: number; symbol: string; tf: string; dir: Dir; title: string; body: string; snap: string | null; likes: number; liked: boolean; comments: number; mine: boolean }
export interface Comment { id: number; user: Author; ts: number; body: string; mine: boolean }
export interface ChatMsg { id: number; user: Author; ts: number; body: string; mine: boolean }
export interface Profile { name: string; joined: number; posts: number; followers: number; following: number; followed: boolean; blocked: boolean }
export interface Report { id: number; kind: 'post' | 'comment' | 'chat'; target_id: number; reason: string; ts: number; resolved: number; reporter?: string | Author; preview?: string; body?: string }
export interface FeedQuery { symbol?: string; user?: string; following?: boolean; before?: number; limit?: number }
export interface Me { name: string; admin: boolean }

const q = (o: Record<string, string | number | boolean | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v === true ? 1 : v!)}`);
  return p.length ? '?' + p.join('&') : '';
};
const S = '/api/social';
const enc = encodeURIComponent;
const del = (path: string) => api<void>(path, { method: 'DELETE' });
const post = <T = void>(path: string, body: unknown = {}) => api<T>(path, { body });

/** Signed-in user and whether this server has the Community module (public mode only). null = not available. */
export async function availability(): Promise<Me | null> {
  if (isStandalone()) return null;
  try {
    const j = await (await serverFetch('/api/auth/status')).json() as { features?: { social?: boolean }; user?: { name?: string; role?: string } };
    return j.features?.social === true && j.user?.name ? { name: j.user.name, admin: j.user.role === 'admin' } : null;
  } catch { return null }
}

export const feed = (o: FeedQuery) => api<{ posts: Post[] }>(`${S}/feed${q({ symbol: o.symbol, user: o.user, following: o.following, before: o.before, limit: o.limit ?? 20 })}`).then(r => r.posts);
export const createPost = (b: { symbol: string; tf: string; dir: string; title?: string; body: string; snap?: string }) => post<Post>(`${S}/posts`, b);
export const deletePost = (id: number) => del(`${S}/posts/${id}`);
export const like = (id: number, on: boolean) => on ? post(`${S}/posts/${id}/like`) : del(`${S}/posts/${id}/like`);
export const comments = (id: number, before?: number) => api<{ comments: Comment[] }>(`${S}/posts/${id}/comments${q({ before, limit: 20 })}`).then(r => r.comments);
export const addComment = (id: number, body: string) => post<Comment>(`${S}/posts/${id}/comments`, { body });
export const deleteComment = (id: number) => del(`${S}/comments/${id}`);
export const profile = (name: string) => api<Profile>(`${S}/profile/${enc(name)}`);
export const follow = (name: string, on: boolean) => on ? post(`${S}/follow/${enc(name)}`) : del(`${S}/follow/${enc(name)}`);
export const block = (name: string, on: boolean) => on ? post(`${S}/block/${enc(name)}`) : del(`${S}/block/${enc(name)}`);
export const report = (kind: Report['kind'], id: number, reason: string) => post(`${S}/report`, { kind, id, reason });
type ServerReport = { id: number; kind: Report['kind']; targetId: number; reason: string; ts: number; resolved: boolean; reporter: Author; target: { body: string } | null };
export const reports = () => api<{ reports: ServerReport[] }>(`${S}/reports?resolved=0`).then(r => r.reports.map((x): Report => ({ id: x.id, kind: x.kind, target_id: x.targetId, reason: x.reason, ts: x.ts, resolved: +x.resolved, reporter: x.reporter, body: x.target?.body })));
/** Names the server says this user blocked (the Me tab list). */
export const blocks = () => api<{ blocked: Author[] }>(`${S}/blocks`).then(r => r.blocked.map(b => b.name));
export const resolveReport = (id: number, hide: boolean) => post(`${S}/reports/${id}/resolve`, { hide });

// ---- chat ----
/** A page of a room, oldest first; `before` pages further back. */
export const chat = (room: string, before?: number) => api<{ messages: ChatMsg[] }>(`${S}/chat/${enc(room)}${q({ before, limit: 50 })}`).then(r => r.messages.reverse());   // the server pages newest first
export const sendChat = (room: string, body: string) => post<ChatMsg>(`${S}/chat/${enc(room)}`, { body });
export const deleteChat = (id: number) => del(`${S}/chat/messages/${id}`);

const joined = new Set<string>();
export const join = (room: string) => { joined.add(room); wsSend({ op: 'social.join', room }) };
export const leave = (room: string) => { joined.delete(room); wsSend({ op: 'social.leave', room }) };
export const leaveAll = () => [...joined].forEach(leave);
/** Live messages of joined rooms. The event socket fans out by `type`, so the server sends { type:'social.msg', room, message }. */
export const onChat = (fn: (room: string, m: ChatMsg) => void) => onServer('social.msg', m => fn(String(m.room), m.message as ChatMsg));
// After a reconnect the server has forgotten our rooms.
onSyncStatus(s => { if (s === 'synced') joined.forEach(r => wsSend({ op: 'social.join', room: r })) });

// ---- snapshot (existing share feature) ----
export async function uploadSnapshot(c: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  if (!blob) throw Error('Could not capture the chart');
  const { id } = await api<{ id: string }>('/api/share/snapshot', { body: blob });
  return id;
}
export const snapUrl = (id: string) => serverUrl(syncServer(), `/s/${enc(id)}`);
