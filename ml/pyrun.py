"""Chart Terminal Python tool: runs the owner's own Python code on the chart's bars.

The server (server/pyrun.ts) starts `python -X utf8 ml/pyrun.py` with one JSON request on stdin and reads one JSON answer
from a private copy of stdout. NOT a sandbox: the code runs with the privileges of the user who started the server.

Request : {code, entry: 'indicator'|'strategy'|'script', bars: [{time,open,high,low,close,volume}], params, name, symbol, tf, timeoutSec}
Answer  : {ok: true, result, stdout, stderr, ...} or {ok: false, error: {type, message, line, traceback}, stdout, stderr, ...}

The code may define PARAMS = {name: default}, indicator(df, params) and/or strategy(df, params), or just print.
`df` is a pandas DataFrame (time = epoch seconds, ascending, open, high, low, close, volume).
Only the standard library is imported here; pandas / numpy are imported lazily and only when the code needs them."""
import json
import linecache
import math
import os
import sys
import threading
import time
import traceback

HARNESS = os.path.abspath(__file__)
LIMIT = 64 * 1024   # captured stdout / stderr: bytes beyond this are dropped while the code runs (a huge print cannot fill memory)
ENTRIES = ('indicator', 'strategy', 'script')

MANAGED = False
_lock = threading.Lock()
_sent = False
_fd = -1


class Capture:
    """File-like object that keeps the first LIMIT characters and counts the rest as truncated."""

    def __init__(self):
        self.parts, self.size, self.truncated = [], 0, False

    def write(self, s):
        s = s if isinstance(s, str) else str(s)
        room = LIMIT - self.size
        if room > 0:
            self.parts.append(s[:room])
            self.size += min(room, len(s))
        if len(s) > max(room, 0):
            self.truncated = True
        return len(s)

    def writelines(self, lines):
        for s in lines:
            self.write(s)

    def flush(self):
        pass

    def isatty(self):
        return False

    def fileno(self):
        raise OSError('captured stream has no file descriptor')

    encoding = 'utf-8'
    errors = 'replace'

    def text(self):
        return ''.join(self.parts)


OUT, ERR = Capture(), Capture()


def emit(obj):
    """Write the answer once, to the private descriptor (user code printing to sys.__stdout__ cannot corrupt it)."""
    global _sent
    with _lock:
        if _sent:
            return
        _sent = True
        obj.update(stdout=OUT.text(), stderr=ERR.text(), truncated={'stdout': OUT.truncated, 'stderr': ERR.truncated}, python=sys.version.split()[0])
        data = json.dumps(obj, allow_nan=False, ensure_ascii=True).encode('ascii')
        try:
            with os.fdopen(_fd, 'wb') as f:
                f.write(data)
        except OSError:
            pass


def leave():
    """End the process. Managed by the server: wait for it to kill this whole tree (it needs a live root to find children the code started)."""
    if MANAGED:
        time.sleep(30)
    os._exit(0)


def to_json(x, depth=0):
    """Plain JSON from lists, dicts, numpy / pandas objects. NaN and +-inf become null."""
    if depth > 40:
        raise ValueError('the result is nested too deeply')
    if x is None or isinstance(x, (bool, str)):
        return x
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {str(k): to_json(v, depth + 1) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [to_json(v, depth + 1) for v in x]
    if hasattr(x, 'tolist'):   # numpy arrays and scalars, pandas Series / Index
        return to_json(x.tolist(), depth + 1)
    if hasattr(x, 'timestamp'):   # datetime, pandas Timestamp -> epoch seconds (NaT -> null)
        try:
            return None if x != x else to_json(float(x.timestamp()), depth + 1)
        except (ValueError, OverflowError):
            return None
    raise TypeError(f'cannot send a value of type {type(x).__name__} to the chart (use numbers, strings, lists, dicts, numpy arrays or pandas Series)')


class ContractError(Exception):
    pass


def check_result(res, n):
    """The shape rules the chart relies on: series are as long as the bars."""
    if not isinstance(res, dict):
        raise ContractError(f'the function must return a dict (got {type(res).__name__}), e.g. {{"plots": [...]}} or {{"trades": [...]}}')
    for i, p in enumerate(res.get('plots') or []):
        if not isinstance(p, dict) or not isinstance(p.get('values'), list):
            raise ContractError(f'plots[{i}] needs "values" (a list, numpy array or pandas Series)')
        if len(p['values']) != n:
            raise ContractError(f'plots[{i}] ("{p.get("name", "")}") has {len(p["values"])} values but df has {n} rows: values must be aligned with df')
    for k in ('position', 'long_entry', 'long_exit', 'short_entry', 'short_exit'):
        if res.get(k) is not None and (not isinstance(res[k], list) or len(res[k]) != n):
            raise ContractError(f'"{k}" must be a list / Series with one value per row of df ({n})')


def failure(e, name):
    """Error record for the UI: the failing line of the USER's code and a traceback without the harness frames."""
    tb = e.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename == HARNESS:
        tb = tb.tb_next
    line, t = None, tb
    while t is not None:
        if t.tb_frame.f_code.co_filename == name:
            line = t.tb_lineno
        t = t.tb_next
    if isinstance(e, SyntaxError) and e.filename == name:
        line = e.lineno
    if isinstance(e, ContractError):
        text = f'{e}\n'
    else:
        text = ''.join(traceback.format_exception(type(e), e, tb))
    return {'type': type(e).__name__, 'message': str(e) if not isinstance(e, SyntaxError) else (e.msg or str(e)), 'line': line, 'traceback': text[-8000:]}


def make_df(bars):
    import pandas as pd
    df = pd.DataFrame(bars, columns=['time', 'open', 'high', 'low', 'close', 'volume'])
    df['time'] = df['time'].astype('int64')
    return df


def run(req):
    src, entry = req.get('code'), req.get('entry')
    if not isinstance(src, str) or entry not in ENTRIES:
        raise ContractError('request needs "code" (text) and "entry" (indicator, strategy or script)')
    name = os.path.basename(str(req.get('name') or 'script.py')) or 'script.py'
    bars = req.get('bars') or []
    params = req.get('params') if isinstance(req.get('params'), dict) else {}
    linecache.cache[name] = (len(src), None, src.splitlines(True), name)   # lets tracebacks show the user's own lines
    df, df_error = None, None
    try:
        df = make_df(bars)
    except ImportError as e:
        df_error = e
    ns = {'__name__': '__main__' if entry == 'script' else 'chart_user_code', '__file__': name, 'df': df, 'bars': bars, 'params': dict(params),
          'symbol': req.get('symbol') or '', 'tf': req.get('tf') or ''}
    try:
        exec(compile(src, name, 'exec'), ns)
        result = None
        if entry != 'script':
            fn = ns.get(entry)
            if not callable(fn):
                raise ContractError(f'no function {entry}(df, params) found in the code')
            if df is None:
                raise ContractError(f'pandas is needed for df ({df_error}): run  pip install pandas numpy')
            merged = dict(ns['PARAMS']) if isinstance(ns.get('PARAMS'), dict) else {}
            merged.update(params)
            ns['params'] = merged
            result = to_json(fn(df, merged))
            check_result(result, len(df))
    except SystemExit as e:
        if e.code not in (None, 0):
            return {'ok': False, 'error': {'type': 'SystemExit', 'message': f'the code exited with status {e.code}', 'line': None, 'traceback': ''}}
        result = None
    except BaseException as e:   # noqa: BLE001 - everything the user's code raises is reported, never crashes the harness
        return {'ok': False, 'error': failure(e, name)}
    return {'ok': True, 'result': result, 'rows': len(bars)}


def main():
    global _fd, MANAGED
    _fd = os.dup(1)
    os.dup2(os.open(os.devnull, os.O_WRONLY), 1)   # anything written to descriptor 1 from here on is discarded
    try:
        req = json.loads(sys.stdin.read())
    except ValueError as e:
        emit({'ok': False, 'error': {'type': 'BadRequest', 'message': f'request is not JSON: {e}', 'line': None, 'traceback': ''}})
        leave()
    MANAGED = req.get('managed') is True if isinstance(req, dict) else False
    sys.stdout, sys.stderr = OUT, ERR
    import io
    sys.stdin = io.StringIO('')
    limit = req.get('timeoutSec')
    if isinstance(limit, (int, float)) and limit > 0:   # the server also kills this whole process tree; this one still returns the partial output
        def stop():
            emit({'ok': False, 'timedOut': True, 'error': {'type': 'Timeout', 'message': f'stopped after {limit:g} s (time limit)', 'line': None, 'traceback': ''}})
            leave()
        t = threading.Timer(limit, stop)
        t.daemon = True
        t.start()
    try:
        emit(run(req))
    except BaseException as e:   # noqa: BLE001
        emit({'ok': False, 'error': failure(e, '')})
    leave()   # also ends threads the user's code left running


if __name__ == '__main__':
    main()
