// Starter scripts for the Python tab (Examples menu). pandas only: no other package is needed.
export const NEW_PY = `# Your Python code runs on this computer, on the bars of the active chart.
# df: pandas DataFrame with time (epoch seconds), open, high, low, close, volume.
# Return lines / markers (indicator) or entry / exit signals or trades (strategy). Plain prints show in the console below.
PARAMS = {"length": 20}   # optional: shown as inputs above the editor


def indicator(df, params):
    sma = df["close"].rolling(params["length"]).mean()
    return {"plots": [{"name": "SMA", "values": sma, "color": "#2962ff", "pane": "overlay"}]}
`;

export const EXAMPLES: { name: string; file: string; src: string }[] = [
  {
    name: 'EMA + RSI indicator (pandas only)', file: 'ema_rsi_indicator.py',
    src: `# EMA cross + RSI. Choose "indicator" and press Run on chart.
PARAMS = {"ema_fast": 12, "ema_slow": 26, "rsi_len": 14}


def indicator(df, params):
    close = df["close"]
    fast = close.ewm(span=params["ema_fast"], adjust=False).mean()
    slow = close.ewm(span=params["ema_slow"], adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / params["rsi_len"], adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / params["rsi_len"], adjust=False).mean()
    rsi = 100 - 100 / (1 + gain / loss)

    up = (fast > slow) & (fast.shift() <= slow.shift())
    down = (fast < slow) & (fast.shift() >= slow.shift())
    markers = [{"time": int(t), "position": "below", "text": "up"} for t in df["time"][up]]
    markers += [{"time": int(t), "position": "above", "text": "down"} for t in df["time"][down]]

    print(f"{len(markers)} crossings in {len(df)} bars")
    return {
        "plots": [
            {"name": "EMA fast", "values": fast, "color": "#2962ff", "pane": "overlay"},
            {"name": "EMA slow", "values": slow, "color": "#ff9800", "pane": "overlay"},
            {"name": "RSI", "values": rsi, "color": "#9c27b0", "pane": "separate"},
        ],
        "hlines": [{"price": 70, "pane": "separate"}, {"price": 30, "pane": "separate"}],
        "markers": markers,
    }
`,
  },
  {
    name: 'Moving-average crossover strategy', file: 'ma_crossover_strategy.py',
    src: `# Long when the fast average crosses above the slow one, flat when it crosses back.
# Choose "strategy" and press Run on chart; the trades appear in the Strategy Tester.
# Signals are for the bar's close and fill at the next bar's open (the same as a Pine strategy).
PARAMS = {"fast": 10, "slow": 30, "qty": 1}


def strategy(df, params):
    fast = df["close"].rolling(params["fast"]).mean()
    slow = df["close"].rolling(params["slow"]).mean()
    return {
        "long_entry": (fast > slow) & (fast.shift() <= slow.shift()),
        "long_exit": (fast < slow) & (fast.shift() >= slow.shift()),
        "qty": params["qty"],
        "plots": [
            {"name": "fast", "values": fast, "color": "#2962ff", "pane": "overlay"},
            {"name": "slow", "values": slow, "color": "#ff9800", "pane": "overlay"},
        ],
    }
`,
  },
];
