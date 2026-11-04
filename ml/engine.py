"""Chart Terminal ML engine: classic machine learning, no language model. numpy + pandas + scikit-learn only, so it runs
the same on Windows, macOS and Linux (`pip install -r ml/requirements.txt`). The server (server/ml.ts) runs this file as
`python ml/engine.py` with one JSON request on stdin and reads one JSON answer from stdout.

Tasks: regime (market-regime clustering), patterns (candlestick patterns with their own track record on this chart, plus
the most similar past price windows), journal (what the trade journal says about the trader's results)."""
import json
import sys

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier, export_text


def _bars(raw):
    df = pd.DataFrame(raw)
    if df.empty or not {"time", "open", "high", "low", "close"} <= set(df.columns):
        raise ValueError("bars need time/open/high/low/close")
    return df.astype({c: float for c in ("open", "high", "low", "close")}).reset_index(drop=True)


def _f(x, nd=4):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


# ---------------------------------------------------------------- regime
def regime(req):
    df = _bars(req["bars"])
    if len(df) < 120:
        raise ValueError("Need at least 120 bars for a regime analysis")
    c = df.close
    ret = np.log(c).diff()
    feat = pd.DataFrame({
        "trend": c / c.shift(20) - 1,
        "vol": ret.rolling(20).std(),
        "range": ((df.high - df.low) / c).rolling(10).mean(),
        "ret": ret.rolling(3).mean(),
    }).dropna()
    km = KMeans(n_clusters=3, n_init=10, random_state=0).fit(StandardScaler().fit_transform(feat))
    lab = pd.Series(km.labels_, index=feat.index)
    g = feat.groupby(lab).mean()
    names = {g["trend"].idxmax(): "Uptrend", g["trend"].idxmin(): "Downtrend"}
    names.update({k: "Range" for k in g.index if k not in names})   # the cluster in between: sideways
    named = lab.map(names)
    full = named.reindex(df.index)
    runs, start = [], None
    for i in named.index:   # consecutive bars of one regime
        if start is None or named[i] != named[start]:
            if start is not None:
                runs.append((start, i - 1, named[start]))
            start = i
    runs.append((start, named.index[-1], named[start]))
    stats = {}
    for n in ("Uptrend", "Downtrend", "Range"):
        m = named == n
        stats[n] = {"share": _f(m.mean(), 3), "avgReturnPct": _f(ret[named.index][m].mean() * 100, 3),
                    "volPct": _f(ret[named.index][m].std() * 100, 3)} if m.any() else None
    last = runs[-1]
    return {
        "labels": [None if pd.isna(v) else v for v in full],
        "current": last[2], "sinceTime": int(df.time[last[0]]), "bars": last[1] - last[0] + 1,
        "stats": stats,
        "segments": [{"from": int(df.time[a]), "to": int(df.time[b]), "regime": r} for a, b, r in runs[-12:]],
        "summary": f"Now in {'an' if last[2][0] == 'U' else 'a'} {last[2].lower()} regime for {last[1] - last[0] + 1} bars. "
                   + ", ".join(f"{n}: {v['share'] * 100:.0f}% of the time" for n, v in stats.items() if v) + ".",
    }


# -------------------------------------------------------------- patterns
def _candles(df):
    o, h, lo, c = df.open, df.high, df.low, df.close
    body, rng = (c - o).abs(), (h - lo).replace(0, np.nan)
    up, dn = c > o, c < o
    upper, lower = h - np.maximum(o, c), np.minimum(o, c) - lo
    down_trend, up_trend = c < c.shift(5), c > c.shift(5)
    p = {}   # name -> (boolean series, +1 bullish / -1 bearish / 0 neutral)
    p["Doji"] = (body <= 0.1 * rng, 0)
    p["Hammer"] = ((lower >= 2 * body) & (upper <= 0.3 * rng) & (body > 0) & down_trend, 1)
    p["Shooting star"] = ((upper >= 2 * body) & (lower <= 0.3 * rng) & (body > 0) & up_trend, -1)
    po, pc = o.shift(), c.shift()
    p["Bullish engulfing"] = (dn.shift(fill_value=False) & up & (o <= pc) & (c >= po), 1)
    p["Bearish engulfing"] = (up.shift(fill_value=False) & dn & (o >= pc) & (c <= po), -1)
    big = body > body.rolling(10).mean()
    mid1 = (o.shift(2) + c.shift(2)) / 2
    p["Morning star"] = (dn.shift(2, fill_value=False) & big.shift(2, fill_value=False) & (body.shift() < 0.3 * body.shift(2)) & up & (c > mid1), 1)
    p["Evening star"] = (up.shift(2, fill_value=False) & big.shift(2, fill_value=False) & (body.shift() < 0.3 * body.shift(2)) & dn & (c < mid1), -1)
    p["Three white soldiers"] = (up & up.shift(fill_value=False) & up.shift(2, fill_value=False) & (c > c.shift()) & (c.shift() > c.shift(2)), 1)
    p["Three black crows"] = (dn & dn.shift(fill_value=False) & dn.shift(2, fill_value=False) & (c < c.shift()) & (c.shift() < c.shift(2)), -1)
    p["Inside bar"] = ((h < h.shift()) & (lo > lo.shift()), 0)
    return {k: (v.fillna(False), d) for k, (v, d) in p.items()}


def patterns(req, horizon=5, recent=20, win=30, ahead=10, k=10):
    df = _bars(req["bars"])
    if len(df) < 100:
        raise ValueError("Need at least 100 bars")
    c = df.close
    fwd = c.shift(-horizon) / c - 1
    found, track = [], {}
    for name, (hit, d) in _candles(df).items():
        idx = np.flatnonzero(hit.to_numpy())
        done = [i for i in idx if np.isfinite(fwd[i])]
        r = fwd.iloc[done] if done else pd.Series(dtype=float)
        track[name] = {"count": len(idx), "avgFwdPct": _f(r.mean() * 100, 3) if len(r) else None,
                       "hitRate": _f(((r > 0) if d >= 0 else (r < 0)).mean(), 3) if len(r) and d else None, "bias": d}
        found += [{"time": int(df.time[i]), "name": name, "bias": d} for i in idx if i >= len(df) - recent]
    found.sort(key=lambda x: x["time"])
    # most similar past windows: shape of the last `win` closes (relative to the window start), compared with every earlier one
    shape = lambda a: (a / a[0] - 1)
    arr = c.to_numpy()
    X = np.array([shape(arr[i:i + win]) for i in range(0, len(arr) - win - ahead)])
    sim = None
    if len(X) > k * 3:
        nn = NearestNeighbors(n_neighbors=k).fit(X)
        dist, ix = nn.kneighbors(shape(arr[-win:]).reshape(1, -1))
        outs = np.array([arr[i + win - 1 + ahead] / arr[i + win - 1] - 1 for i in ix[0]])
        sim = {"window": win, "ahead": ahead, "neighbours": k, "upShare": _f((outs > 0).mean(), 2),
               "avgPct": _f(outs.mean() * 100, 2), "medianPct": _f(np.median(outs) * 100, 2),
               "at": [int(df.time[i + win - 1]) for i in ix[0]]}
    bias = {1: "bullish", -1: "bearish", 0: "neutral"}
    lines = [f"{pd.Timestamp(f['time'], unit='s').strftime('%Y-%m-%d %H:%M')} UTC  {f['name']} ({bias[f['bias']]})" + (f" — historically {track[f['name']]['hitRate'] * 100:.0f}% right over {horizon} bars ({track[f['name']]['count']} cases)" if track[f['name']]['hitRate'] is not None else "") for f in found[-8:]]
    if sim:
        lines.append(f"The {win} latest bars look like {k} earlier windows; {sim['upShare'] * 100:.0f}% of them were higher {ahead} bars later (average {sim['avgPct']}%).")
    return {"found": found, "track": track, "horizon": horizon, "similar": sim, "summary": "\n".join(lines) or "No pattern in the latest bars."}


# --------------------------------------------------------------- journal
def journal(req):
    t = pd.DataFrame(req["trades"])
    if t.empty:
        raise ValueError("The journal has no trades")
    t = t[t.status == "closed"].copy()
    if len(t) < 5:
        raise ValueError("Need at least 5 closed trades")
    scale = 1000 if t.openTime.max() > 1e12 else 1   # seconds or milliseconds
    t["open"] = pd.to_datetime(t.openTime / scale, unit="s", utc=True)
    t["win"] = t.net > 0
    t["hold_min"] = ((t.closeTime.fillna(t.openTime) - t.openTime) / scale / 60)
    t["hour"], t["wday"] = t.open.dt.hour, t.open.dt.day_name()
    t = t.sort_values("open")

    def group(key):
        out = []
        for name, g in t.groupby(key):
            out.append({"name": str(name), "trades": len(g), "winRate": _f(g.win.mean(), 3), "net": _f(g.net.sum(), 2), "avgNet": _f(g.net.mean(), 2)})
        return sorted(out, key=lambda x: x["net"])
    t["setup"] = t.get("setup", pd.Series(index=t.index, dtype=object)).fillna("(none)")
    mis = t.explode("mistakes") if "mistakes" in t else t.assign(mistakes=None)
    mis = mis[mis.mistakes.notna() & (mis.mistakes != "")]
    res = {"trades": len(t), "winRate": _f(t.win.mean(), 3), "net": _f(t.net.sum(), 2),
           "bySetup": group("setup"), "byWeekday": group("wday"), "byHour": group("hour"), "byDirection": group("dir"),
           "byMistake": sorted([{"name": str(n), "trades": len(g), "winRate": _f(g.win.mean(), 3), "net": _f(g.net.sum(), 2)} for n, g in mis.groupby("mistakes")], key=lambda x: x["net"])}
    notes = []
    wins = t.net[t.win]
    losses = t.net[~t.win]
    if len(wins) and len(losses):
        notes.append(f"Average win {wins.mean():.2f} against average loss {losses.mean():.2f}; you need to win {abs(losses.mean()) / (wins.mean() + abs(losses.mean())) * 100:.0f}% of trades to break even and win {t.win.mean() * 100:.0f}%.")
    prev = t.win.shift()
    after_loss, after_win = t.win[prev == False], t.win[prev == True]   # noqa: E712  (shift gives object/NaN)
    if len(after_loss) >= 5 and len(after_win) >= 5:
        res["afterLossWinRate"], res["afterWinWinRate"] = _f(after_loss.mean(), 3), _f(after_win.mean(), 3)
        if after_loss.mean() + 0.15 < after_win.mean():
            notes.append(f"After a losing trade you win {after_loss.mean() * 100:.0f}% (after a winner {after_win.mean() * 100:.0f}%): consider stopping for the day after a loss.")
    for key, label in (("bySetup", "setup"), ("byMistake", "mistake"), ("byWeekday", "weekday"), ("byHour", "hour (UTC)")):
        rows = [r for r in res[key] if r["trades"] >= 3]
        if rows and rows[0]["net"] < 0:
            notes.append(f"Worst {label}: {rows[0]['name']} — {rows[0]['trades']} trades, net {rows[0]['net']}.")
        if rows and rows[-1]["net"] > 0 and len(rows) > 1:
            notes.append(f"Best {label}: {rows[-1]['name']} — {rows[-1]['trades']} trades, net {rows[-1]['net']}.")
    if len(t) >= 30:   # a depth-2 tree on when/how you trade finds the simplest rules that separate winners from losers
        X = pd.DataFrame({"hour": t.hour, "weekday": t.open.dt.weekday, "long": (t.dir == "long").astype(int), "hold_min": t.hold_min.clip(upper=1e5)})
        tree = DecisionTreeClassifier(max_depth=2, min_samples_leaf=max(5, len(t) // 10), random_state=0).fit(X, t.win)
        res["rules"] = export_text(tree, feature_names=list(X.columns))
        res["treeAccuracy"] = _f(tree.score(X, t.win), 3)
        notes.append("A small decision tree over hour, weekday, direction and holding time is in 'rules' (training accuracy only: a hint, not a proof).")
    res["summary"] = "\n".join(notes) or "Nothing stands out yet."
    return res


TASKS = {"regime": regime, "patterns": patterns, "journal": journal}


def main():
    try:
        req = json.load(sys.stdin)
        fn = TASKS.get(req.get("task"))
        if not fn:
            raise ValueError("Unknown task")
        out = fn(req)
    except Exception as e:  # the server shows this text to the user
        out = {"error": str(e) if isinstance(e, (ValueError, KeyError)) else f"{type(e).__name__}: {e}"}
    json.dump(out, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()
