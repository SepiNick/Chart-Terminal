// Community (public mode only): shared analyses, likes, comments, follows, blocks, reports and live chat rooms.
// Cross-user data, so it lives in the central database (users.db). Text is stored as typed (control characters stripped) and is
// never HTML: clients escape it. Live chat rides the existing WebSocket: ops social.join / social.leave, push { op: 'social.msg' }.
import { db, migration } from './core/db.ts';
import { HttpError, bad, clients, obj, onWs, route, type Ctx, type WsClient } from './core/http.ts';
import { allow, onRemoved, shareOwner, userByName } from './core/users.ts';

// Per user, abuse control. One block so the numbers are easy to find.
const H = 3600_000, M = 60_000;
const LIMITS = {
  post: { max: 10, ms: H }, comment: { max: 40, ms: H }, chat: { max: 20, ms: M }, like: { max: 300, ms: H },
  report: { max: 5, ms: H }, follow: { max: 60, ms: H },
  titleMax: 120, postMax: 5000, commentMax: 1000, chatMax: 500, reasonMax: 300, pageMax: 50, pageDefault: 20, roomsPerSocket: 3,
};

migration('social/1', `
  CREATE TABLE social_posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
    dir TEXT NOT NULL CHECK (dir IN ('long','short','neutral')), title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, snap TEXT, hidden INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX social_posts_user ON social_posts (user_id, id);
  CREATE INDEX social_posts_symbol ON social_posts (symbol, id);
  CREATE TABLE social_likes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
  CREATE INDEX social_likes_user ON social_likes (user_id);
  CREATE TABLE social_comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX social_comments_post ON social_comments (post_id, id);
  CREATE INDEX social_comments_user ON social_comments (user_id);
  CREATE TABLE social_follows (follower INTEGER NOT NULL, followee INTEGER NOT NULL, PRIMARY KEY (follower, followee));
  CREATE INDEX social_follows_followee ON social_follows (followee);
  CREATE TABLE social_blocks (blocker INTEGER NOT NULL, blocked INTEGER NOT NULL, PRIMARY KEY (blocker, blocked));
  CREATE INDEX social_blocks_blocked ON social_blocks (blocked);
  CREATE TABLE social_reports (id INTEGER PRIMARY KEY, reporter INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('post','comment','chat')), target_id INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);
  CREATE UNIQUE INDEX social_reports_once ON social_reports (reporter, kind, target_id);
  CREATE INDEX social_reports_open ON social_reports (resolved, id);
  CREATE TABLE social_chat (id INTEGER PRIMARY KEY, room TEXT NOT NULL, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX social_chat_room ON social_chat (room, id);
  CREATE INDEX social_chat_user ON social_chat (user_id, id);`);

// An account removed by the CLI takes all its community rows with it (and everything hanging off its posts).
onRemoved(uid => {
  db.exec('BEGIN');
  try {
    const mine = '(SELECT id FROM social_posts WHERE user_id = ?)';
    db.prepare(`DELETE FROM social_likes WHERE post_id IN ${mine} OR user_id = ?`).run(uid, uid);
    db.prepare(`DELETE FROM social_comments WHERE post_id IN ${mine} OR user_id = ?`).run(uid, uid);
    db.prepare('DELETE FROM social_posts WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM social_follows WHERE follower = ? OR followee = ?').run(uid, uid);
    db.prepare('DELETE FROM social_blocks WHERE blocker = ? OR blocked = ?').run(uid, uid);
    db.prepare('DELETE FROM social_reports WHERE reporter = ?').run(uid);
    db.prepare('DELETE FROM social_chat WHERE user_id = ?').run(uid);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e }
});

// ---------- validation / hygiene ----------
const SYM_RE = /^([A-Z0-9]+:)?[A-Z0-9_.؀-ۿ]{2,40}$/, TF_RE = /^[1-9]\d{0,3}[smhdwM]$/, SNAP_RE = /^[A-Za-z0-9_-]{22}$/;
// NUL and control characters (tab and newline stay), bidi overrides that could disguise text, zero-width noise.
const CTRL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/** Plain text only: strips control characters, collapses 4+ line breaks to 3, trims. Throws when empty or longer than `max` (min 1 unless `optional`). */
export function clean(v: unknown, what: string, max: number, optional = false): string {
  if (v === undefined || v === null) { if (optional) return ''; throw bad(`${what} required`) }
  if (typeof v !== 'string') throw bad(`${what} must be text`);
  const s = v.replace(/\r\n?/g, '\n').replace(CTRL, '').replace(/\n{4,}/g, '\n\n\n').trim();
  if (!s && !optional) throw bad(`${what} required`);
  if (s.length > max) throw bad(`${what} is longer than ${max} characters`);
  return s;
}
const roomOf = (r: string) => { if (r !== 'general' && !(r.startsWith('sym:') && SYM_RE.test(r.slice(4)))) throw bad('Unknown room'); return r };
const idOf = (v: unknown, what = 'id') => { const s = String(v); if (!/^\d{1,15}$/.test(s)) throw bad(`Bad ${what}`); return Number(s) };
const page = (c: Ctx) => {
  const b = c.url.searchParams.get('before'), l = c.url.searchParams.get('limit');
  const limit = l === null ? LIMITS.pageDefault : Math.floor(Number(l));
  if (!Number.isFinite(limit) || limit < 1) throw bad('Bad limit');
  return { before: b === null ? Number.MAX_SAFE_INTEGER : idOf(b, 'before'), limit: Math.min(limit, LIMITS.pageMax) };
};
/** Per-user fixed-window limit, shared with the login throttle store. Counted only once the request is otherwise valid. */
const hit = (c: Ctx, k: keyof Pick<typeof LIMITS, 'post' | 'comment' | 'chat' | 'like' | 'report' | 'follow'>) => {
  if (!allow(`social:${k}:${c.user.id}`, LIMITS[k].max, LIMITS[k].ms)) throw Object.assign(new HttpError(429, `Slow down: too many ${k}s`), { retryAfter: Math.ceil(LIMITS[k].ms / 1000) });
};
const admin = (c: Ctx) => c.user.role === 'admin';
const nameOf = (id: number) => (db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? '';
const same = (table: 'social_posts' | 'social_comments' | 'social_chat', uid: number, body: string) =>
  (db.prepare(`SELECT body FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(uid) as { body: string } | undefined)?.body === body;
const target = (c: Ctx) => { const u = userByName(c.params.name); if (!u) throw new HttpError(404, 'No such user'); return u };

// ---------- posts ----------
const POST_SQL = `SELECT p.id, u.name, p.ts, p.symbol, p.tf, p.dir, p.title, p.body, p.snap,
  (SELECT COUNT(*) FROM social_likes l WHERE l.post_id = p.id) AS likes,
  EXISTS (SELECT 1 FROM social_likes l WHERE l.post_id = p.id AND l.user_id = @me) AS liked,
  (SELECT COUNT(*) FROM social_comments k WHERE k.post_id = p.id AND k.hidden = 0 AND k.user_id NOT IN (SELECT blocked FROM social_blocks WHERE blocker = @me)) AS comments,
  p.user_id = @me AS mine
  FROM social_posts p JOIN users u ON u.id = p.user_id`;
interface PostRow { id: number; name: string; ts: number; symbol: string; tf: string; dir: string; title: string; body: string; snap: string | null; likes: number; liked: number; comments: number; mine: number }
const shape = (r: PostRow) => ({ id: r.id, user: { name: r.name }, ts: r.ts, symbol: r.symbol, tf: r.tf, dir: r.dir, title: r.title, body: r.body, snap: r.snap, likes: r.likes, liked: !!r.liked, comments: r.comments, mine: !!r.mine });
const postById = (id: number, me: number) => { const r = db.prepare(POST_SQL + ' WHERE p.id = @id').get({ id, me }) as PostRow | undefined; return r && shape(r) };
/** A visible post (not hidden); 404 otherwise. */
const livePost = (id: number) => {
  const p = db.prepare('SELECT id, user_id, hidden FROM social_posts WHERE id = ?').get(id) as { id: number; user_id: number; hidden: number } | undefined;
  if (!p || p.hidden) throw new HttpError(404, 'No such post');
  return p;
};
const LIM = { limit: 16 * 1024 };

route('GET', '/api/social/feed', c => {
  const { before, limit } = page(c), q = c.url.searchParams, me = c.user.id;
  const where = ['p.hidden = 0', 'p.id < @before', 'p.user_id NOT IN (SELECT blocked FROM social_blocks WHERE blocker = @me)'];
  const args: Record<string, string | number> = { me, before, limit };
  const symbol = q.get('symbol'), user = q.get('user');
  if (symbol) { where.push('p.symbol = @symbol'); args.symbol = symbol }
  if (user) { where.push('u.name = @user COLLATE NOCASE'); args.user = user }
  if (q.get('following') === '1') where.push('p.user_id IN (SELECT followee FROM social_follows WHERE follower = @me)');
  const rows = db.prepare(`${POST_SQL} WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT @limit`).all(args) as unknown as PostRow[];
  return { posts: rows.map(shape) };
});

route('POST', '/api/social/posts', c => {
  const b = obj(c.body, 'Post');
  const symbol = typeof b.symbol === 'string' ? b.symbol : '', tf = typeof b.tf === 'string' ? b.tf : '';
  if (!SYM_RE.test(symbol)) throw bad('Invalid symbol');
  if (!TF_RE.test(tf)) throw bad('Invalid timeframe');
  if (b.dir !== 'long' && b.dir !== 'short' && b.dir !== 'neutral') throw bad('dir must be long, short or neutral');
  const title = clean(b.title, 'Title', LIMITS.titleMax, true).replace(/\s*\n\s*/g, ' '), text = clean(b.body, 'Text', LIMITS.postMax);
  let snap: string | null = null;
  if (b.snap !== undefined && b.snap !== null) {
    if (typeof b.snap !== 'string' || !SNAP_RE.test(b.snap)) throw bad('Bad snapshot id');
    if (shareOwner(b.snap) !== c.user.id) throw bad('That snapshot is not yours');   // an id of someone else's (or no) snapshot is not attachable
    snap = b.snap;
  }
  if (same('social_posts', c.user.id, text)) throw new HttpError(409, 'You just posted exactly this');
  hit(c, 'post');
  const id = Number(db.prepare('INSERT INTO social_posts (user_id, ts, symbol, tf, dir, title, body, snap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(c.user.id, Date.now(), symbol, tf, b.dir, title, text, snap).lastInsertRowid);
  return postById(id, c.user.id);
}, LIM);

route('DELETE', '/api/social/posts/:id', c => {
  const id = idOf(c.params.id), p = db.prepare('SELECT user_id FROM social_posts WHERE id = ?').get(id) as { user_id: number } | undefined;
  if (!p) throw new HttpError(404, 'No such post');
  if (p.user_id !== c.user.id && !admin(c)) throw new HttpError(403, 'Not your post');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM social_likes WHERE post_id = ?').run(id);
    db.prepare('DELETE FROM social_comments WHERE post_id = ?').run(id);
    db.prepare('DELETE FROM social_posts WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e }
});

route('POST', '/api/social/posts/:id/like', c => {
  const id = idOf(c.params.id); livePost(id);
  if (!db.prepare('SELECT 1 FROM social_likes WHERE post_id = ? AND user_id = ?').get(id, c.user.id)) { hit(c, 'like'); db.prepare('INSERT INTO social_likes (post_id, user_id) VALUES (?, ?)').run(id, c.user.id) }
  return postById(id, c.user.id);
});
route('DELETE', '/api/social/posts/:id/like', c => {
  const id = idOf(c.params.id); livePost(id);
  db.prepare('DELETE FROM social_likes WHERE post_id = ? AND user_id = ?').run(id, c.user.id);
  return postById(id, c.user.id);
});

// ---------- comments ----------
route('GET', '/api/social/posts/:id/comments', c => {
  const id = idOf(c.params.id); livePost(id);
  const { before, limit } = page(c), me = c.user.id;
  const rows = db.prepare(`SELECT k.id, u.name, k.ts, k.body, k.user_id = @me AS mine FROM social_comments k JOIN users u ON u.id = k.user_id
    WHERE k.post_id = @id AND k.hidden = 0 AND k.id < @before AND k.user_id NOT IN (SELECT blocked FROM social_blocks WHERE blocker = @me) ORDER BY k.id DESC LIMIT @limit`).all({ id, me, before, limit }) as { id: number; name: string; ts: number; body: string; mine: number }[];
  return { comments: rows.map(r => ({ id: r.id, user: { name: r.name }, ts: r.ts, body: r.body, mine: !!r.mine })) };
});
route('POST', '/api/social/posts/:id/comments', c => {
  const id = idOf(c.params.id); livePost(id);
  const text = clean(obj(c.body, 'Comment').body, 'Comment', LIMITS.commentMax);
  if (same('social_comments', c.user.id, text)) throw new HttpError(409, 'You just wrote exactly this');
  hit(c, 'comment');
  const ts = Date.now(), cid = Number(db.prepare('INSERT INTO social_comments (post_id, user_id, ts, body) VALUES (?, ?, ?, ?)').run(id, c.user.id, ts, text).lastInsertRowid);
  return { id: cid, user: { name: c.user.name }, ts, body: text, mine: true };
}, LIM);
route('DELETE', '/api/social/comments/:id', c => {
  const id = idOf(c.params.id);
  const k = db.prepare('SELECT k.user_id, p.user_id AS owner FROM social_comments k JOIN social_posts p ON p.id = k.post_id WHERE k.id = ?').get(id) as { user_id: number; owner: number } | undefined;
  if (!k) throw new HttpError(404, 'No such comment');
  if (k.user_id !== c.user.id && k.owner !== c.user.id && !admin(c)) throw new HttpError(403, 'Not allowed');
  db.prepare('DELETE FROM social_comments WHERE id = ?').run(id);
});

// ---------- profiles, follows, blocks ----------
const count = (sql: string, ...a: number[]) => (db.prepare(sql).get(...a) as { n: number }).n;
route('GET', '/api/social/profile/:name', c => {
  const u = target(c), me = c.user.id;
  const created = (db.prepare('SELECT created FROM users WHERE id = ?').get(u.id) as { created: number }).created;
  return {
    name: u.name, joined: created,
    posts: count('SELECT COUNT(*) AS n FROM social_posts WHERE user_id = ? AND hidden = 0', u.id),
    followers: count('SELECT COUNT(*) AS n FROM social_follows WHERE followee = ?', u.id),
    following: count('SELECT COUNT(*) AS n FROM social_follows WHERE follower = ?', u.id),
    followed: count('SELECT COUNT(*) AS n FROM social_follows WHERE follower = ? AND followee = ?', me, u.id) > 0,
    blocked: count('SELECT COUNT(*) AS n FROM social_blocks WHERE blocker = ? AND blocked = ?', me, u.id) > 0,
  };
});
route('GET', '/api/social/blocks', c => ({ blocked: (db.prepare('SELECT u.name FROM social_blocks b JOIN users u ON u.id = b.blocked WHERE b.blocker = ? ORDER BY u.name').all(c.user.id) as { name: string }[]).map(r => ({ name: r.name })) }));

route('POST', '/api/social/follow/:name', c => {
  const u = target(c);
  if (u.id === c.user.id) throw bad('You cannot follow yourself');
  if (count('SELECT COUNT(*) AS n FROM social_blocks WHERE blocker = ? AND blocked = ?', c.user.id, u.id)) throw bad('Unblock this user first');
  if (!count('SELECT COUNT(*) AS n FROM social_follows WHERE follower = ? AND followee = ?', c.user.id, u.id)) { hit(c, 'follow'); db.prepare('INSERT INTO social_follows (follower, followee) VALUES (?, ?)').run(c.user.id, u.id) }
  return { name: u.name, followed: true };
});
route('DELETE', '/api/social/follow/:name', c => {
  const u = target(c);
  db.prepare('DELETE FROM social_follows WHERE follower = ? AND followee = ?').run(c.user.id, u.id);
  return { name: u.name, followed: false };
});
route('POST', '/api/social/block/:name', c => {
  const u = target(c);
  if (u.id === c.user.id) throw bad('You cannot block yourself');
  if (!count('SELECT COUNT(*) AS n FROM social_blocks WHERE blocker = ? AND blocked = ?', c.user.id, u.id)) hit(c, 'follow');   // blocking shares the follow budget
  db.exec('BEGIN');
  db.prepare('INSERT OR IGNORE INTO social_blocks (blocker, blocked) VALUES (?, ?)').run(c.user.id, u.id);
  db.prepare('DELETE FROM social_follows WHERE (follower = ? AND followee = ?) OR (follower = ? AND followee = ?)').run(c.user.id, u.id, u.id, c.user.id);
  db.exec('COMMIT');
  return { name: u.name, blocked: true };
});
route('DELETE', '/api/social/block/:name', c => {
  const u = target(c);
  db.prepare('DELETE FROM social_blocks WHERE blocker = ? AND blocked = ?').run(c.user.id, u.id);
  return { name: u.name, blocked: false };
});

// ---------- reports ----------
const KINDS = { post: 'social_posts', comment: 'social_comments', chat: 'social_chat' } as const;
route('POST', '/api/social/report', c => {
  const b = obj(c.body, 'Report'), kind = b.kind;
  if (kind !== 'post' && kind !== 'comment' && kind !== 'chat') throw bad('kind must be post, comment or chat');
  const id = idOf(b.id), reason = clean(b.reason, 'Reason', LIMITS.reasonMax, true);
  if (!db.prepare(`SELECT 1 FROM ${KINDS[kind]} WHERE id = ?`).get(id)) throw new HttpError(404, 'Nothing to report');
  if (db.prepare('SELECT 1 FROM social_reports WHERE reporter = ? AND kind = ? AND target_id = ?').get(c.user.id, kind, id)) throw new HttpError(409, 'You already reported this');
  hit(c, 'report');
  db.prepare('INSERT INTO social_reports (reporter, kind, target_id, reason, ts) VALUES (?, ?, ?, ?, ?)').run(c.user.id, kind, id, reason, Date.now());
  return { ok: true };
}, LIM);

route('GET', '/api/social/reports', c => {
  if (!admin(c)) throw new HttpError(404, 'Not found');
  const { before, limit } = page(c), resolved = c.url.searchParams.get('resolved') === '1' ? 1 : 0;
  const rows = db.prepare('SELECT * FROM social_reports WHERE resolved = ? AND id < ? ORDER BY id DESC LIMIT ?').all(resolved, before, limit) as { id: number; reporter: number; kind: keyof typeof KINDS; target_id: number; reason: string; ts: number; resolved: number }[];
  return {
    reports: rows.map(r => {
      const t = db.prepare(`SELECT user_id, hidden, body FROM ${KINDS[r.kind]} WHERE id = ?`).get(r.target_id) as { user_id: number; hidden: number; body: string } | undefined;
      return { id: r.id, kind: r.kind, targetId: r.target_id, reason: r.reason, ts: r.ts, resolved: !!r.resolved, reporter: { name: nameOf(r.reporter) },
        target: t ? { user: { name: nameOf(t.user_id) }, body: t.body.slice(0, 300), hidden: !!t.hidden } : null };   // null: already deleted
    }),
  };
});
route('POST', '/api/social/reports/:id/resolve', c => {
  if (!admin(c)) throw new HttpError(404, 'Not found');
  const id = idOf(c.params.id), r = db.prepare('SELECT kind, target_id FROM social_reports WHERE id = ?').get(id) as { kind: keyof typeof KINDS; target_id: number } | undefined;
  if (!r) throw new HttpError(404, 'No such report');
  const hide = obj(c.body ?? {}, 'Body').hide === true;
  if (hide) db.prepare(`UPDATE ${KINDS[r.kind]} SET hidden = 1 WHERE id = ?`).run(r.target_id);
  db.prepare('UPDATE social_reports SET resolved = 1 WHERE kind = ? AND target_id = ?').run(r.kind, r.target_id);   // one decision settles every report of that target
  return { ok: true, hidden: hide };
}, LIM);

// ---------- chat ----------
interface MsgRow { id: number; name: string; ts: number; body: string; mine: number }
const msg = (r: MsgRow) => ({ id: r.id, user: { name: r.name }, ts: r.ts, body: r.body, mine: !!r.mine });
route('GET', '/api/social/chat/:room', c => {
  const room = roomOf(c.params.room), { before, limit } = page(c), me = c.user.id;
  const rows = db.prepare(`SELECT m.id, u.name, m.ts, m.body, m.user_id = @me AS mine FROM social_chat m JOIN users u ON u.id = m.user_id
    WHERE m.room = @room AND m.hidden = 0 AND m.id < @before AND m.user_id NOT IN (SELECT blocked FROM social_blocks WHERE blocker = @me) ORDER BY m.id DESC LIMIT @limit`).all({ room, me, before, limit }) as unknown as MsgRow[];
  return { messages: rows.map(msg) };
});
route('POST', '/api/social/chat/:room', c => {
  const room = roomOf(c.params.room), text = clean(obj(c.body, 'Message').body, 'Message', LIMITS.chatMax);
  if (same('social_chat', c.user.id, text)) throw new HttpError(409, 'You just said exactly this');
  hit(c, 'chat');
  const ts = Date.now(), id = Number(db.prepare('INSERT INTO social_chat (room, user_id, ts, body) VALUES (?, ?, ?, ?)').run(room, c.user.id, ts, text).lastInsertRowid);
  if (id % 500 === 0) db.prepare('DELETE FROM social_chat WHERE id < ?').run(id - 20_000);   // chat is not an archive
  const blockedBy = db.prepare('SELECT 1 FROM social_blocks WHERE blocker = ? AND blocked = ?');
  for (const cl of clients) {
    if (!roomsOf(cl).has(room) || blockedBy.get(cl.userId, c.user.id)) continue;
    cl.send({ type: 'social.msg', op: 'social.msg', room, message: { id, user: { name: c.user.name }, ts, body: text, mine: cl.userId === c.user.id } });
  }
  return { id, user: { name: c.user.name }, ts, body: text, mine: true };
}, LIM);
route('DELETE', '/api/social/chat/messages/:id', c => {
  const id = idOf(c.params.id), m = db.prepare('SELECT user_id FROM social_chat WHERE id = ?').get(id) as { user_id: number } | undefined;
  if (!m) throw new HttpError(404, 'No such message');
  if (m.user_id !== c.user.id && !admin(c)) throw new HttpError(403, 'Not your message');
  db.prepare('DELETE FROM social_chat WHERE id = ?').run(id);
});

// Rooms a socket listens to (at most 3). Joining is allowed to every signed-in user: rooms are public, messages are filtered per receiver.
const roomsOf = (cl: WsClient) => { let s = cl.data.get('social.rooms') as Set<string> | undefined; if (!s) cl.data.set('social.rooms', s = new Set()); return s };
onWs('social.join', (cl, m) => {
  const room = roomOf(String(m.room ?? '')), rooms = roomsOf(cl);
  if (!rooms.has(room) && rooms.size >= LIMITS.roomsPerSocket) throw Error(`You can be in at most ${LIMITS.roomsPerSocket} rooms`);
  rooms.add(room);
  cl.send({ op: 'social.joined', room });
});
onWs('social.leave', (cl, m) => { roomsOf(cl).delete(String(m.room ?? '')); cl.send({ op: 'social.left', room: String(m.room ?? '') }) });
