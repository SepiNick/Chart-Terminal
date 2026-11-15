// Community panel (#s-community): Feed | Following | Chat | Me. Server-side social network of the public server;
// all HTTP/WebSocket calls are in ./api.ts, all pure logic in ./logic.ts. Every piece of user text goes through escapeHtml/linkify.
import { store, toast } from '../store.ts';
import { showMenu } from '../menu.ts';
import { t } from '../i18n.ts';
import * as A from './api.ts';
import { LIMITS, cleanText, escapeHtml as e, isRoom, linkify, mergeById, symbolRoom, timeAgo, validatePost, type Dir } from './logic.ts';
import './strings.ts';

export interface CommunityHost {
  symbol(): string;
  tf(): string;
  shot(): HTMLCanvasElement | null;
  /** Open this symbol (and timeframe) on the active chart. */
  show(sym: string, tf: string): void;
}
type Tab = 'feed' | 'following' | 'chat' | 'me';
interface Feed { posts: A.Post[]; more: boolean; loading: boolean; error: string }
const emptyFeed = (): Feed => ({ posts: [], more: false, loading: false, error: '' });
const PAGE = 20, SNAP_ID = /^[A-Za-z0-9_-]{22}$/;

let host: CommunityHost, box: HTMLElement, me: A.Me | null = null, tab: Tab = 'feed', profileName: string | null = null;
const feeds = { feed: emptyFeed(), following: emptyFeed(), user: emptyFeed() };
const draft = { title: '', body: '', dir: 'long' as Dir, sym: '', tf: '', symTouched: false, snap: false, busy: false };
let onlySym = false, prof: A.Profile | null = null, profErr = '', repList: A.Report[] | null = null;
type Thread = { items: A.Comment[]; more: boolean; loading: boolean; draft?: string };
const threads = new Map<number, Thread>();
// Re-render helpers destroy the focused element; remember it by identity and focus its twin afterwards.
function keepFocus(fn: () => void) {
  const a = document.activeElement as HTMLInputElement | null;
  let sel = '';
  if (a && a !== document.body && box.contains(a)) {
    if (a.id) sel = `#${a.id}`;
    else if (a.classList.contains('cm-cin') || a.dataset.a) {
      const post = a.closest<HTMLElement>('.cm-post')?.dataset.id, msg = a.closest<HTMLElement>('.cm-msg')?.dataset.id;
      sel = (post ? `.cm-post[data-id="${post}"] ` : msg ? `.cm-msg[data-id="${msg}"] ` : '') + (a.classList.contains('cm-cin') ? '.cm-cin' : `[data-a="${a.dataset.a}"]` + ['t', 'd', 'n', 'cid', 'id'].filter(k => a.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(a.dataset[k]!)}"]`).join(''));
    }
  }
  const s = a?.selectionStart ?? null, en = a?.selectionEnd ?? null;
  fn();
  if (!sel) return;
  const n = box.querySelector<HTMLInputElement>(sel);
  if (n) { n.focus({ preventScroll: true }); if (s != null && en != null) try { n.setSelectionRange(s, en) } catch { /* not a text field */ } }
}
let room = 'general', msgs: A.ChatMsg[] = [], chatMore = false, chatErr = '';
let lastSide = '';

const $c = <T extends HTMLElement = HTMLElement>(s: string) => box.querySelector(s) as T | null;
const blocked = () => store.get<string[]>('socialBlocked', []);
const setBlocked = (name: string, on: boolean) => store.set('socialBlocked', [...new Set(on ? [...blocked(), name] : blocked().filter(n => n !== name))]);
const fail = (x: unknown) => toast((x as Error).message || 'Something went wrong');
const curFeed = (): Feed => (tab === 'me' ? feeds.user : tab === 'following' ? feeds.following : feeds.feed);
const dirLabel = (d: string) => t(d === 'long' ? 'Long' : d === 'short' ? 'Short' : 'Neutral');
const findPost = (id: number) => [feeds.feed, feeds.following, feeds.user].flatMap(f => f.posts).find(p => p.id === id);
const mutatePosts = (fn: (p: A.Post) => A.Post | null) => { for (const f of [feeds.feed, feeds.following, feeds.user]) f.posts = f.posts.flatMap(p => fn(p) ?? []) };

export function initCommunity(h: CommunityHost) {
  host = h; box = document.getElementById('s-community')!;
  box.addEventListener('click', onClick);
  box.addEventListener('input', onInput);
  box.addEventListener('submit', ev => { ev.preventDefault(); if ((ev.target as HTMLElement).id === 'cmForm') void submitPost() });
  box.addEventListener('keydown', onKey);
  A.onChat((r, m) => { if (r === room && tab === 'chat' && !blocked().includes(m.user.name)) addMsgs([m]) });
  // Safety net for a socket that dropped: refetch the open room, and leave rooms when the panel is not showing.
  setInterval(() => {
    if (!box.classList.contains('on') || tab !== 'chat') { if (lastSide) A.leaveAll(); lastSide = ''; return }
    if (!document.hidden) { void loadChat(true); A.join(room) }
  }, 10_000);
}

export async function renderCommunity() {
  if (!box) return;
  if (!me) { box.innerHTML = `<h3>Community</h3><p class="muted">${t('Loading…')}</p>`; me = await A.availability() }
  if (!me) { box.innerHTML = `<h3>Community</h3><div class="cm-gate"><b>${t('Community needs a public server with accounts')}</b><p class="muted">${t('Here people share analyses, comment, follow each other and chat. Connect to a public Chart Terminal server and sign in to join.')}</p></div>`; return }
  try { store.set('socialBlocked', await A.blocks()) } catch { /* keep the local copy */ }
  feeds.feed = emptyFeed(); feeds.following = emptyFeed(); feeds.user = emptyFeed();   // reopening the panel shows fresh posts
  draw();
}

// ---------- shell ----------
const TABS: Array<[Tab, string]> = [['feed', 'Feed'], ['following', 'Following'], ['chat', 'Chat'], ['me', 'Me']];
function draw() { keepFocus(draw0) }
function draw0() {
  stopChat();
  box.innerHTML = `<h3>Community <span class="grow"></span><span class="muted" dir="auto">${e(me!.name)}</span></h3>
    <div class="tabs" role="tablist" aria-label="Community">${TABS.map(([k, l]) => `<button role="tab" data-a="tab" data-t="${k}" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="cmView" class="cm-view"></div>`;
  if (tab === 'chat') drawChat(); else if (tab === 'me') drawMe(); else drawFeedView();
}
function stopChat() { lastSide = ''; A.leaveAll() }

// ---------- feed ----------
function drawFeedView() {
  const v = $c('#cmView')!, f = curFeed();
  if (tab === 'feed') {
    if (!draft.symTouched) { draft.sym = host.symbol(); draft.tf = host.tf() }
    v.innerHTML = `<form class="cm-compose" id="cmForm" aria-label="Share analysis">
      <div class="cm-chips" role="group" aria-label="Direction">${(['long', 'short', 'neutral'] as Dir[]).map(d => `<button type="button" class="cm-dir ${d}${draft.dir === d ? ' on' : ''}" data-a="dir" data-d="${d}" aria-pressed="${draft.dir === d}">${dirLabel(d)}</button>`).join('')}
        <input id="cmSym" value="${e(draft.sym)}" size="10" maxlength="40" aria-label="Symbol" dir="ltr"><input id="cmTf" value="${e(draft.tf)}" size="4" maxlength="5" aria-label="Timeframe" dir="ltr"></div>
      <input id="cmTitle" maxlength="${LIMITS.title}" placeholder="Title (optional)" aria-label="Title (optional)" value="${e(draft.title)}" dir="auto">
      <textarea id="cmBody" rows="3" maxlength="${LIMITS.body}" placeholder="Share your analysis…" aria-label="Share analysis" dir="auto">${e(draft.body)}</textarea>
      <div class="row wrap"><label class="cm-chk"><input type="checkbox" id="cmSnap" ${draft.snap ? 'checked' : ''}> Attach chart snapshot</label><span class="grow"></span><button class="on" id="cmPost" ${draft.busy ? 'disabled' : ''}>Share analysis</button></div></form>
      <label class="cm-chk"><input type="checkbox" id="cmOnly" ${onlySym ? 'checked' : ''}> ${e(t('Only this symbol'))}</label>`;
  } else if (tab === 'following') v.innerHTML = `<p class="muted">${t('Posts from people you follow.')}</p>`;
  else v.innerHTML = '';
  v.insertAdjacentHTML('beforeend', `<div id="cmList"></div><div id="cmMore"></div>`);
  drawList();
  if (!f.posts.length && !f.loading && !f.error) void loadFeed(true);
}

function postHtml(p: A.Post): string {
  const th = threads.get(p.id);
  return `<article class="cm-post" data-id="${p.id}">
    <header><button class="cm-user" data-a="user" data-n="${e(p.user.name)}" dir="auto">${e(p.user.name)}</button><span class="muted" title="${e(new Date(p.ts > 1e12 ? p.ts : p.ts * 1000).toLocaleString())}">${t(timeAgo(p.ts))}</span><span class="grow"></span>
      <button class="x" data-a="pmenu" aria-label="More" aria-haspopup="menu">⋯</button></header>
    <div class="cm-meta"><button class="cm-sym" data-a="sym" data-s="${e(p.symbol)}" data-tf="${e(p.tf)}" title="Open on the chart" dir="ltr">${e(p.symbol)} · ${e(p.tf)}</button><span class="cm-dir ${e(p.dir)}">${dirLabel(p.dir)}</span></div>
    ${p.title ? `<b class="cm-title" dir="auto">${e(p.title)}</b>` : ''}
    <div class="cm-body" dir="auto">${linkify(p.body)}</div>
    ${p.snap && SNAP_ID.test(p.snap) ? `<a href="${e(A.snapUrl(p.snap))}" target="_blank" rel="noopener noreferrer"><img class="cm-snap" loading="lazy" alt="Chart snapshot" src="${e(A.snapUrl(p.snap))}"></a>` : ''}
    <footer><button class="cm-like${p.liked ? ' on' : ''}" data-a="like" aria-pressed="${p.liked}" aria-label="Like">${p.liked ? '♥' : '♡'} ${p.likes}</button>
      <button data-a="cmts" aria-expanded="${!!th}" aria-label="Comments">💬 ${p.comments}</button></footer>
    ${th ? `<div class="cm-thread" id="cmt${p.id}">${threadHtml(p, th)}</div>` : ''}</article>`;
}
function drawList() { keepFocus(drawList0) }
function drawList0() {
  const f = curFeed(), l = $c('#cmList'), m = $c('#cmMore'); if (!l || !m) return;
  const hide = (tab === 'feed' && onlySym) ? host.symbol().toUpperCase() : '';
  const posts = hide ? f.posts.filter(p => p.symbol.toUpperCase() === hide) : f.posts;
  l.innerHTML = posts.map(postHtml).join('') || (f.loading || f.error ? '' : `<p class="muted cm-empty">${t(tab === 'following' ? 'Nobody you follow has posted yet.' : 'No analyses yet. Be the first to share one.')}</p>`);
  m.innerHTML = f.error ? `<p class="cm-err" role="alert">${e(f.error)} <button data-a="retry">Retry</button></p>` : f.loading ? `<p class="muted">${t('Loading…')}</p>` : f.more ? `<button data-a="more">Load more</button>` : '';
  obs?.disconnect();
  const mb = m.querySelector('[data-a=more]');
  if (mb && 'IntersectionObserver' in window) { obs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) void loadFeed(false) }); obs.observe(mb) }
}
let obs: IntersectionObserver | null = null;

async function loadFeed(reset: boolean) {
  const f = curFeed(), mine = tab, name = profileName;
  if (f.loading) return;
  f.loading = true; f.error = ''; if (reset) { f.posts = []; f.more = false }
  drawList();
  try {
    const before = reset ? undefined : f.posts.at(-1)?.id;
    const rows = await A.feed({ symbol: tab === 'feed' && onlySym ? host.symbol().toUpperCase() : undefined, user: tab === 'me' ? profileName ?? me!.name : undefined, following: tab === 'following', before, limit: PAGE });
    const hidden = blocked();
    f.posts = mergeById(f.posts, rows.filter(p => !hidden.includes(p.user.name))); f.more = rows.length >= PAGE;
  } catch (x) { f.error = (x as Error).message }
  f.loading = false;
  if (tab === mine && profileName === name) drawList();
}

// ---------- comments ----------
function threadHtml(p: A.Post, th: Thread): string {
  return `${th.more ? `<button class="x" data-a="older" data-id="${p.id}">Load older comments</button>` : ''}
    ${th.items.map(c => `<div class="cm-cmt" data-cid="${c.id}"><button class="cm-user" data-a="user" data-n="${e(c.user.name)}" dir="auto">${e(c.user.name)}</button> <span class="muted">${t(timeAgo(c.ts))}</span>
      ${c.mine || p.mine || me?.admin ? `<button class="x" data-a="cdel" data-cid="${c.id}" aria-label="Delete comment">✕</button>` : `<button class="x" data-a="crep" data-cid="${c.id}" aria-label="Report">⚑</button>`}
      <div dir="auto">${linkify(c.body)}</div></div>`).join('')}
    ${th.loading ? `<p class="muted">${t('Loading…')}</p>` : ''}
    <div class="row"><input class="cm-cin" data-id="${p.id}" value="${e(th.draft ?? '')}" maxlength="${LIMITS.comment}" placeholder="Write a comment…" aria-label="Write a comment…" dir="auto"><button data-a="csend" data-id="${p.id}">Send</button></div>`;
}
function redrawThread(id: number) { const p = findPost(id), th = threads.get(id), el = box.querySelector(`#cmt${id}`); if (p && th && el) keepFocus(() => { el.innerHTML = threadHtml(p, th) }) }
async function loadThread(id: number, older: boolean) {
  const th = threads.get(id)!; th.loading = true; redrawThread(id);
  try {
    const rows = await A.comments(id, older ? th.items[0]?.id : undefined);
    th.items = [...rows.slice().sort((a, b) => a.id - b.id), ...(older ? th.items : [])].filter((c, i, a) => a.findIndex(x => x.id === c.id) === i); th.more = rows.length >= PAGE;
  } catch (x) { fail(x) }
  th.loading = false; redrawThread(id);
}

// ---------- chat ----------
function drawChat() {
  const rooms = ['general', symbolRoom(host.symbol())].filter(isRoom);
  if (!rooms.includes(room)) rooms.push(room);
  $c('#cmView')!.innerHTML = `<div class="row"><select id="cmRoom" aria-label="Chat room">${rooms.map(r => `<option value="${e(r)}" ${r === room ? 'selected' : ''}>${r === 'general' ? t('General') : e(r.slice(4))}</option>`).join('')}</select><span class="grow"></span><span class="muted" id="cmLive"></span></div>
    <div class="cm-msgs" id="cmMsgs" role="log" aria-live="polite" aria-label="Chat messages" tabindex="0"></div>
    <button id="cmNew" class="on" data-a="bottom" hidden>New messages ↓</button>
    <div class="row cm-send"><textarea id="cmIn" rows="2" maxlength="${LIMITS.chat}" placeholder="Message (Enter sends, Shift+Enter for a new line)" aria-label="Message" dir="auto"></textarea><button class="on" data-a="chatsend">Send</button></div>`;
  $c('#cmMsgs')!.addEventListener('scroll', () => { if (nearBottom()) $c('#cmNew')!.hidden = true });
  A.join(room); lastSide = 'chat';
  void loadChat(false);
}
const nearBottom = () => { const m = $c('#cmMsgs'); return !m || m.scrollHeight - m.scrollTop - m.clientHeight < 40 };
function drawMsgs(stick: boolean) {
  const m = $c('#cmMsgs'); if (!m) return;
  const keep = m.scrollHeight - m.scrollTop;
  m.innerHTML = (chatMore ? `<button class="x" data-a="olderchat">Load older messages</button>` : '') + (chatErr ? `<p class="cm-err" role="alert">${e(chatErr)}</p>` : '')
    + (msgs.length || chatErr ? '' : `<p class="muted cm-empty">${t('No messages yet. Say hello.')}</p>`)
    + msgs.map(x => `<div class="cm-msg${x.mine ? ' mine' : ''}" data-id="${x.id}"><header><button class="cm-user" data-a="user" data-n="${e(x.user.name)}" dir="auto">${e(x.user.name)}</button><span class="muted">${t(timeAgo(x.ts))}</span><span class="grow"></span><button class="x" data-a="mmenu" aria-label="More" aria-haspopup="menu">⋯</button></header><div class="cm-mtext" dir="auto">${linkify(x.body)}</div></div>`).join('');
  if (stick) m.scrollTop = m.scrollHeight; else m.scrollTop = m.scrollHeight - keep;
}
function addMsgs(rows: A.ChatMsg[], older = false) {
  const stick = nearBottom(), had = new Set(msgs.map(x => x.id));
  msgs = mergeById(msgs, rows).reverse();
  drawMsgs(older ? false : stick);
  if (!older && !stick && rows.some(x => !had.has(x.id))) { const n = $c('#cmNew'); if (n) n.hidden = false }
}
async function loadChat(quiet: boolean) {
  const r = room;
  try {
    const rows = (await A.chat(r)).filter(x => !blocked().includes(x.user.name));
    if (r !== room || tab !== 'chat') return;
    chatErr = ''; if (!quiet) { msgs = []; chatMore = rows.length >= 50 } addMsgs(rows);
    if (!quiet) drawMsgs(true);
  } catch (x) { if (!quiet) { chatErr = (x as Error).message; drawMsgs(true) } }
}
async function sendChat() {
  const inp = $c<HTMLTextAreaElement>('#cmIn'); if (!inp) return;
  const body = cleanText(inp.value); if (!body) return;
  if (body.length > LIMITS.chat) return toast(`Messages are limited to ${LIMITS.chat} characters`);
  inp.disabled = true;
  try { const m = await A.sendChat(room, body); inp.value = ''; if (!msgs.some(x => x.id === m.id)) { addMsgs([m]); const mm = $c('#cmMsgs'); if (mm) mm.scrollTop = mm.scrollHeight } }
  catch (x) { fail(x) }
  inp.disabled = false; inp.focus();
}

// ---------- me / profiles ----------
function drawMe() {
  const v = $c('#cmView')!, who = profileName ?? me!.name, own = who === me!.name;
  if (own && profileName) profileName = null;
  if (!prof || prof.name !== who) { prof = null; profErr = ''; void A.profile(who).then(p => { prof = p; if (tab === 'me') drawMe() }, x => { profErr = (x as Error).message; if (tab === 'me') drawMe() }) }
  const p = prof;
  v.innerHTML = `<div class="cm-prof">${p ? `<div class="row wrap">${profileName ? `<button class="x" data-a="back" aria-label="Back">←</button>` : ''}<b dir="auto">${e(p.name)}</b><span class="grow"></span>${own ? '' : `<button data-a="follow" class="${p.followed ? '' : 'on'}">${p.followed ? 'Unfollow' : 'Follow'}</button><button data-a="blockp">${p.blocked ? 'Unblock' : 'Block'}</button>`}</div>
      <div class="cm-stats"><span><b>${p.posts}</b> Posts</span><span><b>${p.followers}</b> Followers</span><span><b>${p.following}</b> Following</span></div>
      <p class="muted">${t('Joined')} ${e(new Date(p.joined > 1e12 ? p.joined : p.joined * 1000).toLocaleDateString())}</p>`
      : profErr ? `<p class="cm-err" role="alert">${e(profErr)}</p>` : `<p class="muted">${t('Loading…')}</p>`}</div>`;
  if (own) {
    const bl = blocked();
    v.insertAdjacentHTML('beforeend', `<h4>${t('Blocked people')}</h4>${bl.length ? bl.map(n => `<div class="row"><span dir="auto">${e(n)}</span><span class="grow"></span><button data-a="unblock" data-n="${e(n)}">Unblock</button></div>`).join('') : `<p class="muted">${t('Nobody blocked.')}</p>`}`);
    if (me!.admin) { v.insertAdjacentHTML('beforeend', `<h4>Reports</h4><div id="cmRep"></div>`); void loadReports() }
  }
  v.insertAdjacentHTML('beforeend', `<h4>Posts</h4><div id="cmList"></div><div id="cmMore"></div>`);
  drawList(); if (!feeds.user.posts.length && !feeds.user.loading && !feeds.user.error) void loadFeed(true);
}
async function loadReports() {
  try { repList = await A.reports() } catch (x) { const r = $c('#cmRep'); if (r) r.innerHTML = `<p class="cm-err">${e((x as Error).message)}</p>`; return }
  const r = $c('#cmRep'); if (!r) return;
  r.innerHTML = repList.map(x => `<div class="cm-rep"><div><b>${e(x.kind)} #${x.target_id}</b> <span class="muted" dir="auto">${e(typeof x.reporter === 'object' ? x.reporter?.name ?? '' : x.reporter ?? '')}</span></div>
    ${x.preview ?? x.body ? `<div dir="auto" class="cm-body">${e((x.preview ?? x.body ?? '').slice(0, 300))}</div>` : ''}<div dir="auto">${e(x.reason)}</div>
    <div class="row"><button data-a="rhide" data-id="${x.id}" class="on">Hide</button><button data-a="rdismiss" data-id="${x.id}">Dismiss</button></div></div>`).join('') || `<p class="muted">${t('No open reports.')}</p>`;
}
function openProfile(name: string) {
  tab = 'me'; profileName = name === me!.name ? null : name; prof = null; feeds.user = emptyFeed(); draw();
}

// ---------- actions ----------
async function submitPost() {
  if (draft.busy) return;
  const v = validatePost({ symbol: draft.sym, tf: draft.tf, dir: draft.dir, title: draft.title, body: draft.body });
  if (v.error) return toast(t(v.error));
  draft.busy = true; $c<HTMLButtonElement>('#cmPost')!.disabled = true;
  try {
    let snap: string | undefined;
    if (draft.snap) { const c = host.shot(); if (!c) throw Error('No chart to capture'); snap = await A.uploadSnapshot(c) }
    const p = await A.createPost({ ...v.value, title: v.value.title || undefined, snap });
    feeds.feed.posts = mergeById(feeds.feed.posts, [p]);
    draft.body = ''; draft.title = ''; toast(t('Shared'));
  } catch (x) { fail(x) }
  draft.busy = false; if (tab === 'feed') drawFeedView();
}
async function reportIt(kind: A.Report['kind'], id: number) {
  const r = prompt(t('Why are you reporting this? (optional)'), ''); if (r === null) return;
  try { await A.report(kind, id, (cleanText(r) || 'Other').slice(0, LIMITS.reason)); toast(t('Report sent. Thank you.')) } catch (x) { fail(x) }
}
async function blockUser(name: string, on: boolean) {
  if (on && !confirm(`${t('Block')} ${name}?`)) return;
  try {
    await A.block(name, on); setBlocked(name, on);
    if (on) { mutatePosts(p => (p.user.name === name ? null : p)); msgs = msgs.filter(m => m.user.name !== name) }
    if (prof?.name === name) prof.blocked = on;
    toast(t(on ? 'Blocked' : 'Unblocked')); draw();
  } catch (x) { fail(x) }
}
function menuAt(el: HTMLElement, items: Parameters<typeof showMenu>[2]) { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, items) }

function onClick(ev: MouseEvent) {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]'); if (!el) return;
  const a = el.dataset.a!, pid = Number(el.closest<HTMLElement>('.cm-post')?.dataset.id), post = findPost(pid), mid = Number(el.closest<HTMLElement>('.cm-msg')?.dataset.id);
  switch (a) {
    case 'tab': tab = el.dataset.t as Tab; profileName = null; prof = null; draw(); break;
    case 'dir': draft.dir = el.dataset.d as Dir; drawFeedView(); break;
    case 'user': openProfile(el.dataset.n!); break;
    case 'back': profileName = null; prof = null; draw(); break;
    case 'sym': host.show(el.dataset.s!, el.dataset.tf!); break;
    case 'more': void loadFeed(false); break;
    case 'retry': void loadFeed(false); break;
    case 'like': if (post) {
      const on = !post.liked; mutatePosts(p => (p.id === pid ? { ...p, liked: on, likes: Math.max(0, p.likes + (on ? 1 : -1)) } : p)); drawList();
      A.like(pid, on).catch(x => { mutatePosts(p => (p.id === pid ? { ...p, liked: !on, likes: Math.max(0, p.likes + (on ? -1 : 1)) } : p)); drawList(); fail(x) });
    } break;
    case 'cmts': if (post) { if (threads.has(pid)) threads.delete(pid); else { threads.set(pid, { items: [], more: false, loading: false }); void loadThread(pid, false) } drawList() } break;
    case 'older': void loadThread(Number(el.dataset.id), true); break;
    case 'csend': void sendComment(Number(el.dataset.id)); break;
    case 'cdel': if (confirm(t('Delete this comment?'))) A.deleteComment(Number(el.dataset.cid)).then(() => { const th = threads.get(pid); if (th) th.items = th.items.filter(c => c.id !== Number(el.dataset.cid)); mutatePosts(p => (p.id === pid ? { ...p, comments: Math.max(0, p.comments - 1) } : p)); drawList() }, fail); break;
    case 'crep': void reportIt('comment', Number(el.dataset.cid)); break;
    case 'pmenu': if (post) menuAt(el, [
      ...(post.mine ? [] : [{ label: t('Report'), icon: '⚑', action: () => void reportIt('post', pid) }, { label: `${t('Block')} ${post.user.name}`, icon: '⛔', action: () => void blockUser(post.user.name, true) }]),
      ...(post.mine || me?.admin ? [{ label: t('Delete'), icon: '🗑', action: () => { if (confirm(t('Delete this post?'))) A.deletePost(pid).then(() => { mutatePosts(p => (p.id === pid ? null : p)); drawList() }, fail) } }] : []),
    ]); break;
    case 'follow': if (prof) { const on = !prof.followed; A.follow(prof.name, on).then(() => { prof!.followed = on; prof!.followers += on ? 1 : -1; drawMe() }, fail) } break;
    case 'blockp': if (prof) void blockUser(prof.name, !prof.blocked); break;
    case 'unblock': void blockUser(el.dataset.n!, false); break;
    case 'rhide': case 'rdismiss': A.resolveReport(Number(el.dataset.id), a === 'rhide').then(() => void loadReports(), fail); break;
    case 'bottom': { const m = $c('#cmMsgs'); if (m) m.scrollTop = m.scrollHeight; el.hidden = true; break }
    case 'olderchat': void A.chat(room, msgs[0]?.id).then(rows => { chatMore = rows.length >= 50; addMsgs(rows.filter(x => !blocked().includes(x.user.name)), true) }, fail); break;
    case 'chatsend': void sendChat(); break;
    case 'mmenu': { const m = msgs.find(x => x.id === mid); if (m) menuAt(el, [
      ...(m.mine ? [] : [{ label: t('Report'), icon: '⚑', action: () => void reportIt('chat', mid) }, { label: `${t('Block')} ${m.user.name}`, icon: '⛔', action: () => void blockUser(m.user.name, true) }]),
      ...(m.mine || me?.admin ? [{ label: t('Delete'), icon: '🗑', action: () => void A.deleteChat(mid).then(() => { msgs = msgs.filter(x => x.id !== mid); drawMsgs(false) }, fail) }] : []),
    ]); break }
  }
}
async function sendComment(id: number) {
  const inp = box.querySelector<HTMLInputElement>(`#cmt${id} .cm-cin`); if (!inp) return;
  const body = cleanText(inp.value); if (!body) return;
  if (body.length > LIMITS.comment) return toast(`Comments are limited to ${LIMITS.comment} characters`);
  try {
    const c = await A.addComment(id, body), th = threads.get(id);
    if (th) { th.draft = ''; if (!th.items.some(x => x.id === c.id)) th.items.push(c) }
    mutatePosts(p => (p.id === id ? { ...p, comments: p.comments + 1 } : p));
    const cb = box.querySelector(`.cm-post[data-id="${id}"] [data-a="cmts"]`); if (cb) cb.textContent = `💬 ${findPost(id)?.comments ?? ''}`;
    redrawThread(id);
  } catch (x) { fail(x) }
}
function onInput(ev: Event) {
  const el = ev.target as HTMLInputElement;
  if (el.classList.contains('cm-cin')) { const th = threads.get(Number(el.dataset.id)); if (th) th.draft = el.value }
  else if (el.id === 'cmBody') draft.body = el.value;
  else if (el.id === 'cmTitle') draft.title = el.value;
  else if (el.id === 'cmSym') { draft.sym = el.value; draft.symTouched = true }
  else if (el.id === 'cmTf') { draft.tf = el.value; draft.symTouched = true }
  else if (el.id === 'cmSnap') draft.snap = el.checked;
  else if (el.id === 'cmOnly') { onlySym = el.checked; void loadFeed(true) }
  else if (el.id === 'cmRoom') { A.leave(room); room = el.value; msgs = []; chatErr = ''; drawChat() }
}
function onKey(ev: KeyboardEvent) {
  const el = ev.target as HTMLElement;
  if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && el.getAttribute('role') === 'tab') {
    ev.preventDefault();
    const rtl = getComputedStyle(box).direction === 'rtl', step = (ev.key === 'ArrowRight') !== rtl ? 1 : -1;
    tab = TABS[(TABS.findIndex(x => x[0] === tab) + step + TABS.length) % TABS.length][0]; profileName = null; prof = null; draw();
    box.querySelector<HTMLElement>(`[data-a="tab"][data-t="${tab}"]`)?.focus();
  } else if (ev.key === 'Enter' && el.id === 'cmIn' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void sendChat() }
  else if (ev.key === 'Enter' && el.classList.contains('cm-cin') && !ev.isComposing) { ev.preventDefault(); void sendComment(Number((el as HTMLInputElement).dataset.id)) }
  else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && el.id === 'cmBody') { ev.preventDefault(); void submitPost() }
}
