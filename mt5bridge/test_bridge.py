"""Safety logic of bridge.py against a fake MetaTrader5 module (no terminal needed):
    python -I mt5bridge/test_bridge.py
"""
import os
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace as NS

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ['MT5_BRIDGE_TOKEN_FILE'] = os.path.join(tempfile.mkdtemp(), 'token.txt')


class FakeMt5(types.ModuleType):
    """Unknown constants resolve to distinct ints; tests set the account, symbols and positions."""
    def __init__(self):
        super().__init__('MetaTrader5')
        self._n, self.acct, self.syms, self.pos, self.sent = 1000, None, {}, [], []
        self.ACCOUNT_TRADE_MODE_DEMO, self.ACCOUNT_TRADE_MODE_REAL = 0, 2
        self.ACCOUNT_MARGIN_MODE_RETAIL_NETTING, self.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING = 0, 2
        self.POSITION_TYPE_BUY, self.POSITION_TYPE_SELL = 0, 1
        self.TRADE_RETCODE_DONE, self.TRADE_RETCODE_PLACED, self.TRADE_RETCODE_DONE_PARTIAL = 10009, 10008, 10010

    def __getattr__(self, name):
        if name.isupper():
            self._n += 1
            setattr(self, name, self._n)
            return self._n
        raise AttributeError(name)

    def account_info(self): return self.acct
    def symbol_info(self, s): return self.syms.get(s)
    def symbols_get(self): return list(self.syms.values())
    def symbol_select(self, s, on): return s in self.syms
    def positions_get(self, symbol=None): return [p for p in self.pos if symbol in (None, p.symbol)]
    def symbol_info_tick(self, s): return NS(bid=1.1, ask=1.1002, last=0, time=0)
    def orders_get(self, ticket=None): return []
    def history_orders_get(self, ticket=None): return []
    def last_error(self): return (1, 'fake')

    def order_send(self, req):
        self.sent.append(req)
        return NS(retcode=self.TRADE_RETCODE_DONE, order=1, volume=req['volume'], comment='done')


mt5 = FakeMt5()
sys.modules['MetaTrader5'] = mt5
import bridge  # noqa: E402

EURUSD = NS(name='EURUSDm', trade_contract_size=100000, volume_step=0.01, volume_min=0.01, volume_max=50)


class BridgeSafety(unittest.TestCase):
    def setUp(self):
        mt5.acct = NS(trade_mode=mt5.ACCOUNT_TRADE_MODE_DEMO, margin_mode=mt5.ACCOUNT_MARGIN_MODE_RETAIL_NETTING, login=1, server='x', currency='USD', balance=1000, equity=1000)
        mt5.syms, mt5.pos, mt5.sent = {'EURUSDm': EURUSD}, [], []

    def test_only_demo_netting_accounts_trade(self):
        mt5.acct.trade_mode = mt5.ACCOUNT_TRADE_MODE_REAL
        with self.assertRaisesRegex(bridge.Refused, 'REAL'):
            bridge.place({'sym': 'EURUSDM', 'side': 'buy', 'kind': 'market', 'qty': 1000})
        mt5.acct.trade_mode, mt5.acct.margin_mode = mt5.ACCOUNT_TRADE_MODE_DEMO, mt5.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING
        with self.assertRaisesRegex(bridge.Refused, 'netting'):
            bridge.place({'sym': 'EURUSDM', 'side': 'buy', 'kind': 'market', 'qty': 1000})
        mt5.acct = None
        with self.assertRaisesRegex(bridge.Refused, 'not logged in'):
            bridge.demo_netting()
        self.assertEqual(mt5.sent, [], 'nothing reached the terminal')

    def test_units_to_lots(self):
        self.assertEqual(bridge.lots(EURUSD, 12345), 0.12)        # 0.12345 lots, rounded down to the 0.01 step
        self.assertEqual(bridge.lots(EURUSD, 19999), 0.19)        # never up: 0.19999 lots must not become 0.20
        with self.assertRaisesRegex(bridge.Refused, 'above the maximum'):   # refused, not silently cut down
            bridge.lots(EURUSD, 10_000_000)
        with self.assertRaisesRegex(bridge.Refused, 'below the minimum'):
            bridge.lots(EURUSD, 100)

    def test_symbol_case_and_reduce_only(self):
        with self.assertRaisesRegex(bridge.Refused, 'no opposite position'):
            bridge.place({'sym': 'EURUSDM', 'side': 'sell', 'kind': 'market', 'qty': 50000, 'reduceOnly': True})
        mt5.pos = [NS(symbol='EURUSDm', volume=0.3, type=mt5.POSITION_TYPE_BUY)]
        bridge.place({'sym': 'EURUSDM', 'side': 'sell', 'kind': 'market', 'qty': 90000, 'reduceOnly': True})
        req = mt5.sent[-1]
        self.assertEqual(req['symbol'], 'EURUSDm', 'upper-cased app symbol found case-insensitively')
        self.assertEqual(req['volume'], 0.3, 'reduce-only clamped to the position held')
        with self.assertRaisesRegex(bridge.Refused, 'no opposite position'):
            bridge.place({'sym': 'EURUSDM', 'side': 'buy', 'kind': 'limit', 'price': 1.09, 'qty': 1000, 'reduceOnly': True})

    def test_fill_policy_follows_the_symbol(self):
        for mode, want in ((2, mt5.ORDER_FILLING_IOC), (3, mt5.ORDER_FILLING_IOC), (1, mt5.ORDER_FILLING_FOK), (0, mt5.ORDER_FILLING_RETURN)):
            mt5.syms = {'EURUSDm': NS(**{**EURUSD.__dict__, 'filling_mode': mode})}
            bridge.place({'sym': 'EURUSDM', 'side': 'buy', 'kind': 'market', 'qty': 1000})
            self.assertEqual(mt5.sent[-1]['type_filling'], want, mode)

    def test_unknown_symbol_in_positions_does_not_crash(self):
        mt5.pos = [NS(symbol='GONE', volume=0.1, type=mt5.POSITION_TYPE_BUY, price_open=1, profit=0, price_current=1)]
        self.assertEqual(bridge.get('/positions', {}, True)[0]['qty'], 0.1)

    def test_bad_order_fields_and_empty_token(self):
        for bad in ({'side': 'Buy', 'kind': 'market'}, {'side': 'buy', 'kind': 'nope'}, {'kind': 'market'}):
            with self.assertRaisesRegex(bridge.Refused, 'Bad side'):
                bridge.place({'sym': 'EURUSDM', 'qty': 1000, **bad})
        self.assertEqual(mt5.sent, [])
        with open(bridge.TOKEN_FILE, 'w') as f:
            f.write('')
        self.assertGreaterEqual(len(bridge.token()), 32)    # an empty token file is replaced, never accepted

    def test_account_needs_the_token(self):
        with self.assertRaises(PermissionError):
            bridge.get('/account', {}, False)
        self.assertEqual(bridge.get('/account', {}, True)['currency'], 'USD')


if __name__ == '__main__':
    unittest.main()
