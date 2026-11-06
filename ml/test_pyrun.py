"""Tests for the Python tool harness: python -m unittest ml/test_pyrun.py  (from the project folder)."""
import json
import os
import subprocess
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    import pandas  # noqa: F401
    import numpy  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


def bars(n=50):
    return [dict(time=1_700_000_000 + i * 3600, open=100 + i, high=101 + i, low=99 + i, close=100.5 + i, volume=10) for i in range(n)]


def run(code, entry='script', n=50, timeout=30, **extra):
    req = dict(code=code, entry=entry, bars=bars(n), name='my_algo.py', **{'params': {}, **extra})
    p = subprocess.run([sys.executable, '-X', 'utf8', os.path.join(HERE, 'pyrun.py')], input=json.dumps(req), capture_output=True, text=True, timeout=timeout)
    return json.loads(p.stdout), p


@unittest.skipUnless(HAVE, 'pandas and numpy are needed')
class Harness(unittest.TestCase):
    def test_print_script_sees_df(self):
        r, _ = run('print(len(df), list(df.columns), df.time.iloc[0], params, symbol, tf)', symbol='BTCUSDT', tf='1h')
        self.assertTrue(r['ok'])
        self.assertEqual(r['stdout'].strip(), "50 ['time', 'open', 'high', 'low', 'close', 'volume'] 1700000000 {} BTCUSDT 1h")

    def test_indicator_series_numpy_and_nan(self):
        code = '''
import numpy as np
PARAMS = {"n": 3}
def indicator(df, params):
    ema = df.close.ewm(span=params["n"]).mean()
    ema.iloc[:2] = float("nan")
    arr = np.full(len(df), np.inf)
    return {"plots": [{"name": "ema", "values": ema, "color": "#ff0000", "pane": "overlay"}, {"name": "arr", "values": arr, "pane": "separate"}],
            "markers": [{"time": df.time.iloc[3], "position": "above", "text": "x"}], "hlines": [{"price": np.float64(1.5)}]}
'''
        r, _ = run(code, 'indicator')
        self.assertTrue(r['ok'], r)
        p = r['result']['plots']
        self.assertIsNone(p[0]['values'][0]); self.assertIsNone(p[0]['values'][1]); self.assertIsInstance(p[0]['values'][2], float)
        self.assertTrue(all(v is None for v in p[1]['values']))   # inf -> null
        self.assertEqual(r['result']['markers'][0]['time'], 1_700_000_000 + 3 * 3600)
        self.assertEqual(r['result']['hlines'][0]['price'], 1.5)

    def test_params_override_defaults(self):
        code = 'PARAMS={"n": 3, "m": 1}\ndef indicator(df, params):\n    return {"plots": [{"name": "p", "values": [params["n"] * 10 + params["m"]] * len(df)}]}\n'
        r, _ = run(code, 'indicator', params={'n': 5})
        self.assertEqual(r['result']['plots'][0]['values'][0], 51)

    def test_strategy_signals_and_trades_pass_through(self):
        code = 'def strategy(df, params):\n    return {"position": (df.close > df.close.mean()).astype(int), "trades": [{"entryTime": 1, "entryPrice": 2, "exitTime": 3, "exitPrice": 4, "side": "long", "qty": 1}]}\n'
        r, _ = run(code, 'strategy')
        self.assertTrue(r['ok'], r)
        self.assertEqual(len(r['result']['position']), 50)
        self.assertIn(r['result']['position'][-1], (0, 1))
        self.assertEqual(r['result']['trades'][0]['side'], 'long')

    def test_traceback_points_at_the_users_line_and_hides_harness(self):
        code = 'import math\n\n\ndef indicator(df, params):\n    x = 1\n    return 1 / (x - 1)\n'
        r, _ = run(code, 'indicator')
        self.assertFalse(r['ok'])
        self.assertEqual(r['error']['type'], 'ZeroDivisionError')
        self.assertEqual(r['error']['line'], 6)
        self.assertIn('my_algo.py', r['error']['traceback'])
        self.assertIn('1 / (x - 1)', r['error']['traceback'])
        self.assertNotIn('pyrun.py', r['error']['traceback'])

    def test_error_in_a_library_call_still_maps_to_the_user_line(self):
        code = 'def indicator(df, params):\n    a = 1\n    return {"plots": [{"values": df["nope"]}]}\n'
        r, _ = run(code, 'indicator')
        self.assertEqual(r['error']['type'], 'KeyError')
        self.assertEqual(r['error']['line'], 3)

    def test_syntax_error_has_a_line(self):
        r, _ = run('x = 1\nif x ==\n    pass\n')
        self.assertFalse(r['ok'])
        self.assertEqual(r['error']['type'], 'SyntaxError')
        self.assertEqual(r['error']['line'], 2)

    def test_missing_function_and_bad_return(self):
        r, _ = run('x = 1', 'indicator')
        self.assertFalse(r['ok']); self.assertIn('no function indicator', r['error']['message'])
        r, _ = run('def indicator(df, params):\n    return [1, 2]\n', 'indicator')
        self.assertIn('must return a dict', r['error']['message'])
        r, _ = run('def indicator(df, params):\n    return {"plots": [{"name": "a", "values": [1, 2, 3]}]}\n', 'indicator')
        self.assertIn('aligned with df', r['error']['message'])
        r, _ = run('def indicator(df, params):\n    return {"plots": [{"values": [object()] * len(df)}]}\n', 'indicator')
        self.assertIn('cannot send a value of type object', r['error']['message'])

    def test_exit_status_and_main_guard(self):
        r, _ = run('import sys\nsys.exit(3)')
        self.assertFalse(r['ok']); self.assertIn('status 3', r['error']['message'])
        r, _ = run('import sys\nsys.exit(0)')
        self.assertTrue(r['ok'])
        r, _ = run('print("main" if __name__ == "__main__" else "lib")')
        self.assertEqual(r['stdout'].strip(), 'main')
        r, _ = run('print("main" if __name__ == "__main__" else "lib")\ndef indicator(df, params): return {}', 'indicator')
        self.assertEqual(r['stdout'].strip(), 'lib')

    def test_stderr_and_output_cap_for_a_huge_print(self):
        t0 = time.time()
        r, p = run('import sys\nprint("e", file=sys.stderr)\nfor i in range(2_000_000): print("x" * 100)\n', timeout=60)
        self.assertTrue(r['ok'])
        self.assertEqual(r['stderr'].strip(), 'e')
        self.assertLessEqual(len(r['stdout']), 64 * 1024)
        self.assertTrue(r['truncated']['stdout']); self.assertFalse(r['truncated']['stderr'])
        self.assertLess(len(p.stdout), 200 * 1024)   # nothing but the answer reached the real stdout
        self.assertLess(time.time() - t0, 55)

    def test_writes_to_the_real_stdout_cannot_corrupt_the_answer(self):
        r, _ = run('import sys, os\nsys.__stdout__.write("garbage")\nos.write(1, b"more garbage")\nprint("fine")\n')
        self.assertTrue(r['ok']); self.assertEqual(r['stdout'].strip(), 'fine')

    def test_infinite_loop_is_stopped_by_the_watchdog_with_partial_output(self):
        t0 = time.time()
        r, _ = run('print("before")\nwhile True:\n    pass\n', timeoutSec=1.5, timeout=30)
        self.assertFalse(r['ok']); self.assertTrue(r['timedOut'])
        self.assertEqual(r['error']['type'], 'Timeout')
        self.assertEqual(r['stdout'].strip(), 'before')
        self.assertLess(time.time() - t0, 15)

    def test_user_threads_do_not_keep_the_process_alive(self):
        t0 = time.time()
        r, _ = run('import threading, time\nthreading.Thread(target=lambda: time.sleep(60)).start()\nprint("done")\n', timeout=30)
        self.assertTrue(r['ok']); self.assertLess(time.time() - t0, 20)

    def test_bad_request(self):
        p = subprocess.run([sys.executable, '-X', 'utf8', os.path.join(HERE, 'pyrun.py')], input='nope', capture_output=True, text=True, timeout=30)
        self.assertEqual(json.loads(p.stdout)['error']['type'], 'BadRequest')
        r, _ = run('print(1)', 'nonsense')
        self.assertFalse(r['ok'])

    def test_non_ascii_source_and_output(self):
        r, _ = run('# قیمت\nprint("سلام ✓")\n')
        self.assertEqual(r['stdout'].strip(), 'سلام ✓')


if __name__ == '__main__':
    unittest.main()
