"""MetaTrader 5 bridge for Chart Terminal (ROADMAP phase 11).

Run it on the Windows PC where the MetaTrader 5 terminal is open and logged in to a DEMO account:

    pip install MetaTrader5
    python mt5bridge/bridge.py

It listens on 127.0.0.1:8789 only. Market data (/account, /symbols, /bars, /tick) needs no token; everything that
reads or changes the trading account needs the token printed at start (saved in mt5bridge/token.txt), which the
app's MT5 account uses as its "API key". Trading is refused unless the terminal is on a DEMO account with netting
(one position per symbol), checked on every request. MT5 pushes no prices to Python, so the app polls.
"""
import json
import math
import os
import secrets
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import MetaTrader5 as mt5

HOST, PORT = '127.0.0.1', int(os.environ.get('MT5_BRIDGE_PORT', '8789'))
TOKEN_FILE = os.environ.get('MT5_BRIDGE_TOKEN_FILE') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'token.txt')
TF = {'1m': mt5.TIMEFRAME_M1, '5m': mt5.TIMEFRAME_M5, '15m': mt5.TIMEFRAME_M15, '30m': mt5.TIMEFRAME_M30, '1h': mt5.TIMEFRAME_H1,
      '4h': mt5.TIMEFRAME_H4, '1d': mt5.TIMEFRAME_D1, '1w': mt5.TIMEFRAME_W1, '1M': mt5.TIMEFRAME_MN1}


def token():
    if os.path.exists(TOKEN_FILE):
        t = open(TOKEN_FILE, encoding='utf-8').read().strip()
        if len(t) >= 32:   # an empty or cut-short file (crash while writing) would otherwise accept requests with no token
            return t
    t = secrets.token_hex(24)
    with open(TOKEN_FILE, 'w', encoding='utf-8') as f:
        f.write(t)
    return t


TOKEN = token()


class Refused(Exception):
    pass


def account():
    a = mt5.account_info()
    if a is None:
        raise Refused('MetaTrader 5 is not logged in to an account')
    return a


def demo_netting():
    """Every trading call goes through here: a real-money or hedging account is refused before anything is sent."""
    a = account()
    if a.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise Refused('MetaTrader 5 is logged in to a REAL account: the bridge only trades on demo accounts')
    if a.margin_mode != mt5.ACCOUNT_MARGIN_MODE_RETAIL_NETTING:
        raise Refused('Use a netting demo account (one position per symbol); hedging accounts are not supported')
    return a


def info(sym):
    """The app upper-cases symbols; brokers often don't (EURUSDm), so the name is matched case-insensitively."""
    s = mt5.symbol_info(sym)
    if s is None:
        real = next((x.name for x in mt5.symbols_get() or [] if x.name.upper() == sym.upper()), None)
        s = mt5.symbol_info(real) if real else None
    if s is None or not mt5.symbol_select(s.name, True):
        raise Refused(f'Unknown symbol {sym}')
    return s


def lots(s, units):
    """App quantities are in units (lots x contract size), so position caps compare real notionals."""
    step = s.volume_step or 0.01
    v = round(math.floor(units / s.trade_contract_size / step + 1e-9) * step, 8)   # rounded DOWN: the order never exceeds the notional the app's cap checked
    if v < s.volume_min:
        raise Refused(f'{units} units is below the minimum of {s.volume_min} lots ({s.volume_min * s.trade_contract_size} units)')
    if v > s.volume_max:
        raise Refused(f'{units} units is above the maximum of {s.volume_max} lots ({s.volume_max * s.trade_contract_size} units)')
    return v


def csize(sym):
    """Contract size of a symbol, 1 when the terminal no longer knows it (an old deal in the history of a delisted symbol)."""
    s = mt5.symbol_info(sym)
    return s.trade_contract_size if s else 1


def filling(s):
    """Brokers allow different fill policies (symbol.filling_mode bit 1 = FOK, bit 2 = IOC); a wrong one is rejected (10030)."""
    m = getattr(s, 'filling_mode', 0) or 0
    return mt5.ORDER_FILLING_IOC if m & 2 else mt5.ORDER_FILLING_FOK if m & 1 else mt5.ORDER_FILLING_RETURN


KIND = {mt5.ORDER_TYPE_BUY: ('buy', 'market'), mt5.ORDER_TYPE_SELL: ('sell', 'market'), mt5.ORDER_TYPE_BUY_LIMIT: ('buy', 'limit'),
        mt5.ORDER_TYPE_SELL_LIMIT: ('sell', 'limit'), mt5.ORDER_TYPE_BUY_STOP: ('buy', 'stop'), mt5.ORDER_TYPE_SELL_STOP: ('sell', 'stop'),
        mt5.ORDER_TYPE_BUY_STOP_LIMIT: ('buy', 'stop_limit'), mt5.ORDER_TYPE_SELL_STOP_LIMIT: ('sell', 'stop_limit')}
STATUS = {mt5.ORDER_STATE_FILLED: 'filled', mt5.ORDER_STATE_CANCELED: 'canceled', mt5.ORDER_STATE_REJECTED: 'rejected', mt5.ORDER_STATE_EXPIRED: 'canceled'}


def order_out(o, history=False):
    cs = csize(o.symbol)
    side, kind = KIND.get(o.type, ('buy', 'market'))
    stop = kind in ('stop', 'stop_limit')
    filled = (o.volume_initial - o.volume_current) * cs
    return {'id': str(o.ticket), 'sym': o.symbol, 'side': side, 'kind': kind, 'qty': o.volume_initial * cs, 'filled': filled,
            'status': STATUS.get(o.state, 'filled' if filled and history else 'open') if history else 'open',
            'created': o.time_setup * 1000, 'updated': (o.time_done or o.time_setup) * 1000,
            **({'price': o.price_stoplimit if kind == 'stop_limit' else o.price_open} if kind in ('limit', 'stop_limit') else {}),
            **({'stopPrice': o.price_open} if stop else {})}


def send(req):
    demo_netting()   # again, right before the order leaves: the terminal may have been switched since the caller checked
    r = mt5.order_send(req)
    if r is None:
        raise Refused(f'order_send failed: {mt5.last_error()}')
    if r.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, mt5.TRADE_RETCODE_DONE_PARTIAL):
        raise Refused(f'MT5 refused the order: {r.comment} ({r.retcode})')
    return r


def place(b):
    demo_netting()
    side, kind = b.get('side'), b.get('kind')
    if side not in ('buy', 'sell') or kind not in ('market', 'limit', 'stop', 'stop_limit'):
        raise Refused('Bad side or order kind')
    s = info(str(b['sym']))
    sym = s.name
    vol = lots(s, float(b['qty']))
    buy = side == 'buy'
    if b.get('reduceOnly'):
        pos = mt5.positions_get(symbol=sym) or []
        held = sum(p.volume * (1 if p.type == mt5.POSITION_TYPE_BUY else -1) for p in pos)
        if not held or (held > 0) == buy:
            raise Refused('Reduce-only: there is no opposite position to reduce')
        vol = min(vol, abs(held))
    if kind == 'market':
        t = mt5.symbol_info_tick(sym)
        req = {'action': mt5.TRADE_ACTION_DEAL, 'type': mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL, 'price': t.ask if buy else t.bid,
               'deviation': 20, 'type_filling': filling(s)}
    else:
        types = {'limit': (mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_SELL_LIMIT), 'stop': (mt5.ORDER_TYPE_BUY_STOP, mt5.ORDER_TYPE_SELL_STOP),
                 'stop_limit': (mt5.ORDER_TYPE_BUY_STOP_LIMIT, mt5.ORDER_TYPE_SELL_STOP_LIMIT)}
        req = {'action': mt5.TRADE_ACTION_PENDING, 'type': types[kind][0 if buy else 1], 'type_filling': mt5.ORDER_FILLING_RETURN,
               'price': float(b['stopPrice'] if kind in ('stop', 'stop_limit') else b['price'])}
        if kind == 'stop_limit':
            req['stoplimit'] = float(b['price'])
    req.update({'symbol': sym, 'volume': vol, 'magic': 20261029, 'comment': 'Chart Terminal', 'type_time': mt5.ORDER_TIME_GTC})
    r = send(req)
    o = (mt5.orders_get(ticket=r.order) or mt5.history_orders_get(ticket=r.order) or [None])[0]
    return order_out(o, history=kind == 'market') if o else {'id': str(r.order), 'sym': sym, 'side': side, 'kind': kind, 'qty': vol * s.trade_contract_size,
                                                             'filled': r.volume * s.trade_contract_size, 'status': 'filled' if kind == 'market' else 'open', 'created': int(time.time() * 1000), 'updated': int(time.time() * 1000)}


def get(path, q, authed):
    one = lambda k, d=None: q.get(k, [d])[0]
    if path == '/account':
        if not authed:
            raise PermissionError   # login, server and balance are the user's business, not any local process's
        a = account()
        return {'login': a.login, 'server': a.server, 'currency': a.currency, 'demo': a.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO,
                'netting': a.margin_mode == mt5.ACCOUNT_MARGIN_MODE_RETAIL_NETTING, 'balance': a.balance, 'equity': a.equity}
    if path == '/symbols':
        return [{'sym': s.name, 'name': s.description, 'path': s.path} for s in (mt5.symbols_get() or [])]
    if path == '/bars':
        sym, tf = info(one('symbol', '')).name, TF.get(one('tf', ''))
        if tf is None:
            raise Refused('Unsupported timeframe')
        until, count = one('until'), min(5000, max(1, int(one('count', '1000'))))
        rates = mt5.copy_rates_from(sym, tf, int(float(until)) if until else int(time.time()) + 86400, count)
        return [{'time': int(r['time']), 'open': float(r['open']), 'high': float(r['high']), 'low': float(r['low']), 'close': float(r['close']),
                 'volume': float(r['real_volume'] or r['tick_volume'])} for r in (rates if rates is not None else [])]
    if path == '/tick':
        t = mt5.symbol_info_tick(info(one('symbol', '')).name)
        return {'bid': t.bid, 'ask': t.ask, 'last': t.last or (t.bid + t.ask) / 2, 'time': t.time}
    if not authed:
        raise PermissionError
    a = demo_netting()
    if path == '/balances':
        return [{'asset': a.currency, 'free': a.equity, 'locked': 0}]
    if path == '/positions':
        out = []
        for p in mt5.positions_get() or []:
            cs = csize(p.symbol)
            out.append({'sym': p.symbol, 'qty': p.volume * cs * (1 if p.type == mt5.POSITION_TYPE_BUY else -1), 'entry': p.price_open, 'upnl': p.profit, 'mark': p.price_current})
        return out
    if path == '/orders':
        return [order_out(o) for o in mt5.orders_get() or []]
    if path == '/order':
        t = int(one('id', '0'))
        live = mt5.orders_get(ticket=t)
        if live:
            return order_out(live[0])
        h = mt5.history_orders_get(ticket=t)
        if not h:
            raise Refused('Unknown order')
        return order_out(h[0], history=True)
    if path == '/fills':
        since = int(time.time()) - 7 * 86400
        out = []
        for d in mt5.history_deals_get(since, int(time.time()) + 60) or []:
            if d.type not in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL) or not d.symbol:
                continue
            cs = csize(d.symbol)
            out.append({'id': str(d.ticket), 'orderId': str(d.order), 'sym': d.symbol, 'side': 'buy' if d.type == mt5.DEAL_TYPE_BUY else 'sell',
                        'qty': d.volume * cs, 'price': d.price, 'fee': -(d.commission + d.fee), 'realized': d.profit + d.swap, 'ts': d.time_msc})
        return out[-100:]
    raise LookupError


def post(path, b):
    if path == '/order':
        return place(b)
    if path == '/cancel':
        demo_netting()
        send({'action': mt5.TRADE_ACTION_REMOVE, 'order': int(b['id'])})
        return {'ok': True}
    raise LookupError


class Handler(BaseHTTPRequestHandler):
    timeout = 10   # a client that connects and sends nothing must not block this single-threaded server

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self, fn):
        # A page in a browser can't reach us under another name (DNS rebinding) and has no token for the account.
        if self.headers.get('host') not in (f'{HOST}:{PORT}', f'localhost:{PORT}'):
            return self.reply(403, {'error': 'Bad host'})
        if self.headers.get('sec-fetch-site') == 'cross-site':
            return self.reply(403, {'error': 'Cross-site request'})
        authed = False
        try:
            authed = secrets.compare_digest(self.headers.get('x-bridge-token', '').encode(), TOKEN.encode())
            self.reply(200, fn(authed))
        except Refused as e:
            self.reply(400, {'error': str(e)})
        except PermissionError:
            self.reply(401, {'error': 'Bridge token required'})
        except LookupError:
            self.reply(404, {'error': 'Not found'})
        except Exception as e:  # noqa: BLE001 - the app shows the message
            self.reply(500, {'error': f'{type(e).__name__}: {e}' if authed else 'Bridge error'})

    def do_GET(self):
        u = urlparse(self.path)
        self.handle_any(lambda authed: get(u.path, parse_qs(u.query), authed))

    def do_POST(self):
        u = urlparse(self.path)

        def run(authed):
            if not authed:
                raise PermissionError
            n = int(self.headers.get('content-length') or 0)
            if not 0 <= n <= 4096:
                raise Refused('Body too large')
            return post(u.path, json.loads(self.rfile.read(n) or b'{}'))
        self.handle_any(run)

    def log_message(self, *_):
        pass


if __name__ == '__main__':
    if not mt5.initialize():
        raise SystemExit(f'Could not connect to the MetaTrader 5 terminal: {mt5.last_error()} — open MT5 and log in first')
    a = mt5.account_info()
    print(f'MT5 bridge on http://{HOST}:{PORT} — account {a.login if a else "?"} on {a.server if a else "?"} ({"DEMO" if a and a.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "NOT demo: trading refused"})')
    print(f'Token (use it as the API key of the MT5 account in the app): {TOKEN}')
    try:
        HTTPServer((HOST, PORT), Handler).serve_forever()
    finally:
        mt5.shutdown()
