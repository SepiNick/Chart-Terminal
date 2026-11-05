// Per-user limits. Private mode keeps today's caps (and no others); public mode uses the defaults of
// docs/research/multiuser-design.md §4, overridable per user (users.quota JSON) and per server (CT_QUOTA_<NAME> env,
// e.g. CT_QUOTA_ALERTS=100, CT_QUOTA_MEDIA_MB=50). A request over a limit gets a 4xx with a plain message.
import { HttpError } from './errors.ts';
import { isPublic } from './mode.ts';

const MB = 1024 * 1024;
const PUBLIC = {
  alerts: 50, watchUser: 30, watchServer: 400, alertLog: 1000, pushSubs: 5, notifyPerMin: 20, notifyPerDay: 200,
  stateMb: 20, stateKeys: 200, stateKeyMb: 2, journalKeyMb: 8, restoreMb: 30, mediaMb: 100, mediaItems: 200, mediaEachMb: 15,
  shares: 50, shareMb: 30, snapMb: 4, dbMb: 150, rps: 20, burst: 60, inflight: 16, sockets: 4, wsMsgPerSec: 20, subsSocket: 40, subsUser: 100,
};
export type Limits = typeof PUBLIC;
const PRIVATE: Limits = {   // what the single-user server always allowed; everything else unlimited
  alerts: 500, watchUser: Infinity, watchServer: Infinity, alertLog: 5000, pushSubs: Infinity, notifyPerMin: Infinity, notifyPerDay: Infinity,
  stateMb: Infinity, stateKeys: Infinity, stateKeyMb: Infinity, journalKeyMb: Infinity, restoreMb: Infinity, mediaMb: Infinity, mediaItems: Infinity, mediaEachMb: 15,
  shares: Infinity, shareMb: Infinity, snapMb: 8, dbMb: Infinity, rps: Infinity, burst: Infinity, inflight: Infinity, sockets: Infinity, wsMsgPerSec: Infinity, subsSocket: Infinity, subsUser: Infinity,
};
const snake = (k: string) => k.replace(/[A-Z]/g, c => '_' + c).toUpperCase();
const base: Limits = { ...(isPublic ? PUBLIC : PRIVATE) };
if (isPublic) for (const k of Object.keys(PUBLIC) as (keyof Limits)[]) { const v = Number(process.env['CT_QUOTA_' + snake(k)]); if (process.env['CT_QUOTA_' + snake(k)] && v >= 0) base[k] = v }

/** Per-user overrides come from users.db; registered by users.ts so this file stays free of database imports. */
let overrides: (uid: number) => Partial<Limits> = () => ({});
export const setOverrides = (f: typeof overrides) => { overrides = f };
export const limits = (uid: number): Limits => (isPublic ? { ...base, ...overrides(uid) } : base);
export const bytes = (mb: number) => mb * MB;

/** 429 for "you have too many of X", 413 for "this is too big". */
export const tooMany = (what: string, max: number) => new HttpError(429, `Limit reached: at most ${max} ${what}`);
export const tooBig = (what: string, maxMb: number) => new HttpError(413, `${what} is larger than the ${maxMb} MB limit`);
