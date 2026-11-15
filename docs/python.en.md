[English](python.en.md) · [فارسی](python.md)

# Python tool: run your own Python code on chart data

The **Python** tab sits in the bottom panel, next to the Pine Editor. You open or paste code you have already written (using pandas/numpy), and "Run on chart" executes it on the same candles you see on the active chart. Lines, markers and strategy trades appear on the chart and in the Strategy Tester through the same mechanism as Pine.

> **Warning: this is not a sandbox.** The code runs on your computer with the same privileges as the program that started the server: it can read, modify and delete files and connect to the network. Only run code you wrote yourself or trust. The timer and the process-tree kill stop an infinite loop, not malicious code.

## Turning it on

It is **off** by default and can only be turned on from **this very computer** (the `localhost` address): server settings (the Server button) -> the "Python" section -> "Enabled". A separate switch, "Also let phones and other devices…" (`py.remote`), is off by default; until it is turned on, sessions from phones and the local network cannot run code even after a successful login. Both are stored in the server database (config table, key `py`). If the server sits behind a local reverse proxy, set `CT_TRUST_PROXY=1` so the real client address is seen.

## Code contract

A `.py` file (or pasted code) may define the following; none of them is required:

```python
PARAMS = {"fast": 10, "slow": 30}      # optional: shown as inputs above the editor

def indicator(df, params):             # lines, markers, horizontal lines
    return {
        "plots":   [{"name": "EMA", "values": ema, "color": "#2962ff", "pane": "overlay"}],   # "separate" = lower pane
        "markers": [{"time": 1700000000, "position": "above", "text": "x", "shape": "arrow_down"}],
        "hlines":  [{"price": 70, "color": "#888", "pane": "separate"}],
    }

def strategy(df, params):              # one of two ways
    return {"trades": [{"entryTime": t0, "entryPrice": 1.0, "exitTime": t1, "exitPrice": 2.0, "side": "long", "qty": 1}]}
    # or signals: long_entry / long_exit / short_entry / short_exit (booleans), or position (-1, 0, 1 after each candle closes)
```

- `df`: a `pandas.DataFrame` with the columns `time` (epoch seconds, ascending), `open`, `high`, `low`, `close`, `volume`. In plain code, `params`, `symbol`, `tf` and `bars` (the raw list) are also available.
- `values` and signals: a list, a `pandas.Series` or a numpy array, **the same length as df**. `NaN` and `inf` become `null`. The `time` of markers is epoch seconds (or a `Timestamp`) and snaps to the nearest earlier candle.
- **Signals** are filled by the same Broker as Pine strategies: an order placed on the close of candle i is executed at the **open of the next candle**. A signal on the last candle has nowhere to execute. `qty` (default 1), `initial_capital` (10,000) and `commission_pct` can be returned in the same dict. **trades** are recorded exactly as you give them (no re-filling). A trade without `exitTime` stays open.
- Plain code with just `print`: choose the "whole script" entry; the output (stdout/stderr) appears in the console below the editor (up to 64 KB). In this mode `__name__ == "__main__"` is true; in indicator/strategy it is false (until the "Direct run" section of the file is executed).
- The "Run" entry is picked automatically from the functions you have defined. `PARAMS` is read only when it is a **literal** dict (numbers, `True/False`, text) at the top level of the file.
- Errors: the line in **your** code that raised the error is marked in the editor, and the traceback, without the tool's own frames, appears in the console.

## Examples

File menu (🐍) -> Examples: "EMA + RSI indicator" (pandas only) and "Moving-average crossover strategy". Their code is in `src/python/examples.ts`.

## Installing pandas and numpy, and choosing the interpreter

```
pip install pandas numpy
```

(`--user` packages are also found; the interpreter is not run with `-I`.) Windows default: `python`, then `py -3`, then `python3`; Linux/Mac: `python3`, then `python`. For another interpreter (for example a venv), set the environment variable **`CT_PYTHON`** to its path. The version and installed packages are shown in the server settings and at `GET /api/py/status`. Time limit: `CT_PY_TIMEOUT` (seconds, default 60).

## Security model and limits

- Off by default; it can only be turned on from loopback (both the client address and the Host name must be local); access from other devices has a separate switch.
- Every route requires login (401 without it). Only **one run at a time** per user; a concurrent run is rejected with 429 (it is not queued).
- Caps: 20,000 candles, 512 KB of code, 16 MB request body, 32 MB response, 64 KB each for stdout/stderr.
- Each run is a fresh process in a temporary folder that is deleted afterwards. After it finishes or hits the time limit, the server kills the **whole process tree** (`taskkill /T` on Windows). **Memory and CPU are not limited**, and the code can access the rest of your files.
- The result is computed only once, on the candles as they were at the moment of the run (it is fixed and is not re-run on live ticks), and it is removed from the chart when the symbol or timeframe changes. Results are placed on the chart by **time** (not by candle index), so loading older history does not shift them.
- Optimize, walk-forward, alerts and forward test do not work for Python (the code would have to be re-run on the server).
- "Live file link" (Link a file: automatic reload from disk) is **not implemented**; you bring a file in with "Open file" or by drag and drop (the file name is kept), and you must reopen it to pick up changes made on disk.
- The Desktop/Lite packages do not ship the `ml/` folder (like `engine.py` for ML); in them the tool shows the message "missing from this installation". Run from source or Docker.

## Why it is not available in public and standalone modes

- The **public server** is multi-user, and each user's code would run with the server owner's privileges; the `server/pyrun.ts` module is not imported at all when `CT_MODE=public` (routes return 404, `status.features.python=false`; tested in `isolation.test.ts`).
- **Standalone** (the app without a server) has no Python interpreter: the tab opens but shows the message "Python needs a server on this computer".

## Tests

`python -m unittest ml/test_pyrun.py` (converters, NaN, traceback line number, infinite loop, very large print), `server/pyrun.test.ts` (access, time limit, killing the child process, caps, 429) and `src/python/python.test.ts` (PARAMS, result normalization, trade mapping).
