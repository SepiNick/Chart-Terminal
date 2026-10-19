// Per-browser persistence. Every access is guarded: storage can be missing or blocked.
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('ct.' + key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem('ct.' + key, JSON.stringify(value));
    } catch {}
  },
};

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function toast(msg: string, ms = 3000) {
  const d = document.createElement('div');
  d.textContent = msg;
  $('#toast').append(d);
  setTimeout(() => d.remove(), ms);
}

export const calcPrec = (p: number) => (p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 6 : 8);
export const fmtVol = (v: number) =>
  v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(2);
