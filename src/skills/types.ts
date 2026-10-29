// In-app versions of the installed trading skills (claude-trading-skills, trader-skills): each skill's rules and
// scoring rebuilt on the app's own data, no language model. A skill is plain data plus a run() function; one renderer
// (src/skills/ui.ts) draws every form and result, so a skill is just its logic, which is what the tests check.
import type { Bar } from '../data.ts';

export type Group = 'Risk & sizing' | 'Portfolio' | 'Journal & review' | 'Market regime' | 'Screeners' | 'Fundamentals' | 'Options & futures';
export interface Input {
  key: string; label: string;
  type: 'number' | 'text' | 'select' | 'bool' | 'symbol' | 'symbols' | 'json';
  default?: unknown; options?: string[]; hint?: string; optional?: boolean;
}
export type Tone = 'up' | 'dn' | 'warn' | 'muted';
export interface Result {
  verdict?: { label: string; tone: Tone; detail?: string };
  kpis?: { label: string; value: string | number; tone?: Tone }[];
  tables?: { title: string; cols: string[]; rows: (string | number | null)[][] }[];
  notes?: string[];
}
/** What a skill may read. Proposals only: nothing here places an order. */
export interface Ctx {
  bars(sym: string, tf: string): Promise<Bar[]>;
  /** The app's accounts: paper equity and positions, journal trades. */
  account(): { equity: number; cash: number; positions: { sym: string; qty: number; avg: number; px: number }[] };
  trades(): { sym: string; dir: 'long' | 'short'; openTime: number; closeTime?: number; net: number; r?: number | null; status: string; setup?: string; mistakes?: string[] }[];
  json<T>(path: string): Promise<T>;   // the app's own server (/api/...)
}
export interface Skill {
  id: string; name: string; group: Group;
  /** The installed skill it comes from (shown in the panel). */
  from: string;
  desc: string;
  inputs: Input[];
  run(v: Record<string, unknown>, ctx: Ctx): Result | Promise<Result>;
}

export const num = (v: unknown, name: string, { min = -Infinity, max = Infinity, optional = false } = {}): number => {
  if ((v === '' || v == null) && optional) return NaN;
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) throw new Error(`${name}: enter a number`);
  if (n < min || n > max) throw new Error(`${name}: must be between ${min} and ${max}`);
  return n;
};
export const money = (x: number) => (Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '–');
export const pct = (x: number, d = 2) => (Number.isFinite(x) ? `${x.toFixed(d)}%` : '–');
