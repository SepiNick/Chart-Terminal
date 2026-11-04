// Output, errors, program/terminal info, symbol info (SymbolInfo*, MarketInfo), global variables, misc.
import type { Env, Rt } from '../contract.ts';
import { num, put, str, val, getter, setErr } from './util.ts';
import { format } from './string.ts';
import { MqlTick } from './structs.ts';
import { nameOf } from './constants.ts';

const QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'BTC', 'ETH', 'BNB', 'TRY', 'BRL'];
function currencies(sym: string): [string, string] {
  const s = sym.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (s.length === 6 && !/USDT|USDC/.test(s)) return [s.slice(0, 3), s.slice(3)];
  for (const q of QUOTES) if (s.endsWith(q) && s.length > q.length) return [s.slice(0, -q.length), q];
  return [s.slice(0, 3), s.slice(3) || 'USD'];
}

export function installInfo(rt: Rt, env: Env) {
  const m4 = env.dialect === 'mql4';
  const A = env.account, [base, quote] = currencies(env.symbol);
  const C = (k: string) => rt[k] as number;
  const bid = () => env.price(), ask = () => env.price() + env.spreadPoints * env.point;
  const out = (args: unknown[]) => args.map(str).join('');
  rt.__err = 0;
  Object.assign(rt, {
    Print: (...a: unknown[]) => env.log('print', out(a)),
    PrintFormat: (f: unknown, ...a: unknown[]) => env.log('print', format(str(f), a)),
    printf: (f: unknown, ...a: unknown[]) => env.log('print', format(str(f), a)),
    Comment: (...a: unknown[]) => env.log('comment', out(a)),
    Alert: (...a: unknown[]) => env.log('alert', out(a)),
    MessageBox: (t: unknown) => { env.log('alert', str(t)); return 1 },
    PlaySound: () => true, SendNotification: (t: unknown) => { env.log('print', `notification: ${str(t)}`); return true },
    SendMail: (s: unknown) => { env.log('print', `mail: ${str(s)}`); return true }, SendFTP: () => false,
    GetLastError: () => { const e = num(rt.__err); if (m4) rt.__err = 0; return e },
    ResetLastError: () => { rt.__err = 0 },
    SetUserError: (c: number) => { rt.__err = 65536 + (num(c) & 0xffff) },
    IsStopped: () => !!rt.__stopped,
    ExpertRemove: () => { rt.__stopped = true; env.stop() },
    TerminalClose: () => { rt.__stopped = true; env.stop(); return true },
    UninitializeReason: () => num(rt.__deinitReason ?? 0),
    IsTesting: () => !!(rt.__tester ?? true), IsOptimization: () => false, IsVisualMode: () => false,
    IsConnected: () => true, IsDemo: () => true, IsDllsAllowed: () => false, IsExpertEnabled: () => true, IsLibrariesAllowed: () => false,
    TerminalCompany: () => 'Chart Terminal', TerminalName: () => 'Chart Terminal', TerminalPath: () => '',
    TerminalInfoInteger: (p: number) => {
      const q = num(p);
      return q === C('TERMINAL_BUILD') ? 1400 : q === C('TERMINAL_CONNECTED') ? 1 : q === C('TERMINAL_MAXBARS') ? 100000 : q === C('TERMINAL_CODEPAGE') ? 0
        : q === C('TERMINAL_CPU_CORES') ? 4 : q === C('TERMINAL_SCREEN_DPI') ? 96 : q === C('TERMINAL_X64') ? 1 : q === C('TERMINAL_TRADE_ALLOWED') ? 1 : 0;
    },
    TerminalInfoDouble: () => 0,
    TerminalInfoString: (p: number) => { const q = num(p); return q === C('TERMINAL_LANGUAGE') ? 'English' : q === C('TERMINAL_NAME') || q === C('TERMINAL_COMPANY') ? 'Chart Terminal' : '' },
    MQLInfoInteger: (p: number) => {
      const q = num(p), t = !!(rt.__tester ?? true);
      return q === C('MQL_PROGRAM_TYPE') ? num(rt.__programType ?? 2) : q === C('MQL_TESTER') ? +t : q === C('MQL_TRADE_ALLOWED') ? 1 : q === C('MQL_LICENSE_TYPE') ? 0 : q === C('MQL_MEMORY_LIMIT') ? 4096 : 0;
    },
    MQLInfoString: (p: number) => (num(p) === C('MQL_PROGRAM_NAME') ? String(rt.__programName ?? '') : ''),
    MQL5InfoInteger: (p: number) => (rt.MQLInfoInteger as (p: number) => number)(p), MQL5InfoString: (p: number) => (rt.MQLInfoString as (p: number) => string)(p),
    EventSetTimer: (s: number) => { rt.__timer = num(s); return true }, EventSetMillisecondTimer: (ms: number) => { rt.__timer = num(ms) / 1000; return true }, EventKillTimer: () => { rt.__timer = 0 },
    EnumToString: (v: unknown, hint?: unknown) => { const x = val(v); if (typeof x !== 'number') return str(x); return (hint ? nameOf(rt as Record<string, number>, x, str(hint)) : '') || String(x) },
    ErrorDescription: (c: number) => nameOf(rt as Record<string, number>, num(c), 'ERR_') || `error ${num(c)}`,
    ZeroMemory: (o: unknown) => { const x = val(o); if (x && typeof x === 'object') for (const k of Object.keys(x)) { const v = (x as Record<string, unknown>)[k]; (x as Record<string, unknown>)[k] = typeof v === 'string' ? '' : typeof v === 'boolean' ? false : typeof v === 'number' ? 0 : v } },
    DebugBreak: () => {},
  });
  Object.defineProperty(rt, '_LastError', { get: () => num(rt.__err), set: (v: number) => { rt.__err = v }, configurable: true, enumerable: true });
  getter(rt, '_StopFlag', () => !!rt.__stopped);
  getter(rt, '_RandomSeed', () => 0);
  getter(rt, '_IsX64', () => true);

  // Symbol information (only the chart symbol is known).
  const dbl = (p: number): number | undefined => {
    switch (p) {
      case C('SYMBOL_BID'): case C('SYMBOL_LAST'): case C('SYMBOL_BIDHIGH'): case C('SYMBOL_BIDLOW'): case C('SYMBOL_LASTHIGH'): case C('SYMBOL_LASTLOW'): return bid();
      case C('SYMBOL_ASK'): case C('SYMBOL_ASKHIGH'): case C('SYMBOL_ASKLOW'): return ask();
      case C('SYMBOL_POINT'): case C('SYMBOL_TRADE_TICK_SIZE'): return env.point;
      case C('SYMBOL_TRADE_TICK_VALUE'): case C('SYMBOL_TRADE_TICK_VALUE_PROFIT'): case C('SYMBOL_TRADE_TICK_VALUE_LOSS'): return A.contractSize * env.point;
      case C('SYMBOL_TRADE_CONTRACT_SIZE'): return A.contractSize;
      case C('SYMBOL_VOLUME_MIN'): return A.minLot; case C('SYMBOL_VOLUME_MAX'): return A.maxLot; case C('SYMBOL_VOLUME_STEP'): return A.lotStep;
      case C('SYMBOL_SWAP_LONG'): return A.swapLong ?? 0; case C('SYMBOL_SWAP_SHORT'): return A.swapShort ?? 0;
      case C('SYMBOL_VOLUME_LIMIT'): case C('SYMBOL_MARGIN_INITIAL'): case C('SYMBOL_MARGIN_MAINTENANCE'): return 0;
      case C('SYMBOL_MARGIN_HEDGED'): return A.contractSize;
      case C('SYMBOL_VOLUME_REAL'): return env.bars[env.cur()]?.volume ?? 0;
      case C('SYMBOL_SESSION_OPEN'): return env.bars[env.cur()]?.open ?? 0;
      case C('SYMBOL_SESSION_CLOSE'): return env.bars[env.cur() - 1]?.close ?? 0;
      case C('SYMBOL_POINT_VALUE'): return A.contractSize * env.point;
    }
    return undefined;
  };
  const int = (p: number): number | undefined => {
    switch (p) {
      case C('SYMBOL_DIGITS'): return env.digits; case C('SYMBOL_SPREAD'): return env.spreadPoints; case C('SYMBOL_SPREAD_FLOAT'): return 0;
      case C('SYMBOL_TRADE_STOPS_LEVEL'): return A.stopLevelPoints; case C('SYMBOL_TRADE_FREEZE_LEVEL'): return 0;
      case C('SYMBOL_TIME'): return env.now(); case C('SYMBOL_TIME_MSC'): return env.now() * 1000;
      case C('SYMBOL_SELECT'): case C('SYMBOL_VISIBLE'): case C('SYMBOL_EXIST'): return 1;
      case C('SYMBOL_VOLUME'): case C('SYMBOL_VOLUMEHIGH'): case C('SYMBOL_VOLUMELOW'): return env.bars[env.cur()]?.volume ?? 0;
      case C('SYMBOL_TRADE_MODE'): return 4;   // SYMBOL_TRADE_MODE_FULL
      case C('SYMBOL_FILLING_MODE'): return 3; case C('SYMBOL_EXPIRATION_MODE'): return 15; case C('SYMBOL_ORDER_MODE'): return 127;
    }
    return undefined;
  };
  const strp = (p: number): string | undefined => {
    switch (p) {
      case C('SYMBOL_NAME'): case C('SYMBOL_DESCRIPTION'): case C('SYMBOL_PATH'): return env.symbol;
      case C('SYMBOL_CURRENCY_BASE'): case C('SYMBOL_CURRENCY_MARGIN'): return base; case C('SYMBOL_CURRENCY_PROFIT'): return quote;
    }
    return p >= 600 && p < 700 ? '' : undefined;
  };
  const known = (s: unknown) => { const x = str(s); return !x || x === env.symbol };
  const q = <T>(f: (p: number) => T | undefined, def: T) => (s: unknown, p: number, o?: unknown) => {
    const v = known(s) ? f(num(p)) : undefined;
    if (v === undefined) setErr(rt, known(s) ? 4303 : 4301);
    if (o !== undefined) { if (v !== undefined) put(o, v); return v !== undefined }
    return v ?? def;
  };
  Object.assign(rt, {
    SymbolInfoDouble: q(dbl, 0), SymbolInfoInteger: q(int, 0), SymbolInfoString: q(strp, ''),
    SymbolInfoTick: (s: unknown, t: MqlTick) => { if (!known(s)) return false; Object.assign(val<MqlTick>(t), { time: env.now(), bid: bid(), ask: ask(), last: bid(), volume: env.bars[env.cur()]?.volume ?? 0, time_msc: env.now() * 1000, flags: 6, volume_real: env.bars[env.cur()]?.volume ?? 0 }); return true },
    SymbolSelect: (s: unknown) => known(s), SymbolsTotal: () => 1, SymbolName: () => env.symbol, SymbolExist: (s: unknown, c?: unknown) => { put(c, false); return known(s) },
    SymbolIsSynchronized: () => true, SymbolInfoSessionQuote: () => false, SymbolInfoSessionTrade: () => false,
    MarketInfo: (s: unknown, mode: number) => {
      if (!known(s)) { setErr(rt, 4106); return 0 }
      switch (num(mode)) {
        case 1: return env.bars[env.cur()]?.low ?? 0; case 2: return env.bars[env.cur()]?.high ?? 0; case 5: return env.now();
        case 9: return bid(); case 10: return ask(); case 11: return env.point; case 12: return env.digits; case 13: return env.spreadPoints;
        case 14: return A.stopLevelPoints; case 15: return A.contractSize; case 18: return A.swapLong ?? 0; case 19: return A.swapShort ?? 0; case 16: return A.contractSize * env.point; case 17: return env.point;
        case 22: return 1; case 23: return A.minLot; case 24: return A.lotStep; case 25: return A.maxLot;
        case 29: return 0; case 30: return 0; case 31: return A.contractSize / 2; case 32: return (A.contractSize * ask()) / Math.max(1, A.leverage);
        default: return 0;
      }
    },
  });

  // Global variables of the client terminal (in-memory).
  const gv = new Map<string, { v: number; t: number }>();
  Object.assign(rt, {
    GlobalVariableSet: (n: unknown, v: number) => { const t = env.now(); gv.set(str(n), { v: num(v), t }); return t },
    GlobalVariableGet: (n: unknown, o?: unknown) => { const e = gv.get(str(n)); if (!e) setErr(rt, m4 ? 4058 : 4501); if (o !== undefined) { if (e) put(o, e.v); return !!e } return e?.v ?? 0 },
    GlobalVariableCheck: (n: unknown) => gv.has(str(n)),
    GlobalVariableDel: (n: unknown) => gv.delete(str(n)),
    GlobalVariableTime: (n: unknown) => gv.get(str(n))?.t ?? 0,
    GlobalVariableTemp: (n: unknown) => { if (!gv.has(str(n))) gv.set(str(n), { v: 0, t: env.now() }); return true },
    GlobalVariableSetOnCondition: (n: unknown, v: number, c: number) => { const e = gv.get(str(n)); if (!e || e.v !== num(c)) return false; e.v = num(v); e.t = env.now(); return true },
    GlobalVariablesDeleteAll: (prefix = '', before = 0) => { let k = 0; for (const [n, e] of gv) if (n.startsWith(str(prefix)) && (!before || e.t < before)) { gv.delete(n); k++ } return k },
    GlobalVariablesTotal: () => gv.size, GlobalVariableName: (i: number) => [...gv.keys()][num(i)] ?? '', GlobalVariablesFlush: () => {},
  });
}
