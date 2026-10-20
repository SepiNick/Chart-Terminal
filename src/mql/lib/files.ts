// File functions (FileOpen & co.) on a sandboxed in-memory file system per run: text and CSV only, positions in
// characters, FILE_COMMON and code pages ignored. Nothing ever touches the real disk.
import type { Env, Rt } from '../contract.ts';
import { num, str, setErr } from './util.ts';

export const FILE_CONST = {
  FILE_READ: 1, FILE_WRITE: 2, FILE_BIN: 4, FILE_CSV: 8, FILE_TXT: 16, FILE_ANSI: 32, FILE_UNICODE: 64, FILE_SHARE_READ: 128, FILE_SHARE_WRITE: 256,
  FILE_REWRITE: 512, FILE_COMMON: 4096, SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2, CP_ACP: 0, CP_UTF8: 65001,
};
const E_OPEN = 5004, E_HANDLE = 5007, E_NOT_WRITE = 5009, E_NOT_READ = 5010, E_NOT_EXIST = 5019;
interface H { key: string; flags: number; pos: number; delim: string; eol: boolean }

export function installFiles(rt: Rt, env: Env) {
  for (const [k, v] of Object.entries(FILE_CONST)) if (rt[k] === undefined) rt[k] = v;
  const fs = (env.files ??= new Map<string, string>()), open = new Map<number, H>();
  let next = 1;
  const keyOf = (name: unknown) => str(name).replace(/\\/g, '/').toLowerCase();
  const get = (h: unknown, need = 0): H | null => {
    const f = open.get(num(h));
    if (!f) { setErr(rt, E_HANDLE); return null }
    if (need && !(f.flags & need)) { setErr(rt, need === 1 ? E_NOT_READ : E_NOT_WRITE); return null }
    return f;
  };
  const write = (f: H, s: string) => {   // overwrite at the current position (MQL semantics), growing the file as needed
    const c = fs.get(f.key) ?? '';
    fs.set(f.key, c.slice(0, f.pos) + s + c.slice(f.pos + s.length));
    f.pos += s.length;
    return s.length;
  };
  /** Next CSV field (up to the delimiter or line end) or, for TXT files, the rest of the line. */
  const field = (f: H): string => {
    const c = fs.get(f.key) ?? '', csv = !!(f.flags & 8);
    let i = f.pos, out = '';
    if (csv && c[i] === '"') {
      for (i++; i < c.length; i++) { if (c[i] === '"') { if (c[i + 1] === '"') { out += '"'; i++; continue } i++; break } out += c[i] }
    } else while (i < c.length && c[i] !== '\n' && c[i] !== '\r' && !(csv && c[i] === f.delim)) out += c[i++];
    f.eol = i >= c.length || c[i] === '\r' || c[i] === '\n';
    if (c[i] === '\r') i++;
    if (i < c.length && (c[i] === '\n' || (csv && c[i] === f.delim))) i++;
    f.pos = i;
    return out;
  };
  Object.assign(rt, {
    FileOpen(name: unknown, flags: unknown, delim: unknown = '\t') {
      const fl = num(flags), key = keyOf(name);
      if (!(fl & 3) || !key) { setErr(rt, E_OPEN); return -1 }
      if (!(fl & 2) && !fs.has(key)) { setErr(rt, E_OPEN); return -1 }
      if ((fl & 2) && !(fl & 1)) fs.set(key, '');
      else if (!fs.has(key)) fs.set(key, '');
      const h = next++;
      open.set(h, { key, flags: fl, pos: 0, delim: typeof delim === 'number' ? String.fromCharCode(delim) : str(delim).slice(0, 1) || '\t', eol: false });
      return h;
    },
    FileClose: (h: unknown) => { open.delete(num(h)) },
    FileFlush: () => {},
    FileWrite(h: unknown, ...a: unknown[]) { const f = get(h, 2); return f ? write(f, a.map(str).join(f.delim) + '\r\n') : 0 },
    FileWriteString(h: unknown, s: unknown, len?: unknown) { const f = get(h, 2); if (!f) return 0; const t = str(s); return write(f, len == null ? t : t.slice(0, num(len))) },
    FileReadString(h: unknown, len?: unknown) {
      const f = get(h, 1); if (!f) return '';
      if (len != null && num(len) > 0) { const c = fs.get(f.key) ?? '', s = c.slice(f.pos, f.pos + num(len)); f.pos += s.length; return s }
      return field(f);
    },
    FileReadNumber(h: unknown) { const f = get(h, 1); if (!f) return 0; const v = Number(field(f).trim()); return Number.isFinite(v) ? v : 0 },
    FileReadBool(h: unknown) { const f = get(h, 1); if (!f) return false; const v = field(f).trim().toLowerCase(); return v === 'true' || (v !== '' && v !== 'false' && Number(v) !== 0) },
    FileIsEnding(h: unknown) { const f = get(h); return !f || f.pos >= (fs.get(f.key) ?? '').length },
    FileIsLineEnding(h: unknown) { const f = get(h); return !f || f.eol },
    FileIsExist: (name: unknown) => fs.has(keyOf(name)),
    FileDelete(name: unknown) { if (!fs.delete(keyOf(name))) { setErr(rt, E_NOT_EXIST); return false } return true },
    FileSeek(h: unknown, off: unknown, origin: unknown) {
      const f = get(h); if (!f) return false;
      const len = (fs.get(f.key) ?? '').length, base = num(origin) === 1 ? f.pos : num(origin) === 2 ? len : 0;
      f.pos = Math.max(0, Math.min(len, base + num(off)));
      return true;
    },
    FileSize(h: unknown) { const f = get(h); return f ? (fs.get(f.key) ?? '').length : 0 },
    FileTell(h: unknown) { const f = get(h); return f ? f.pos : 0 },
  });
}
