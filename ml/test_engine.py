"""Self-check: python ml/test_engine.py"""
import json, subprocess, sys, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def run(req):
    p = subprocess.run([sys.executable, os.path.join(HERE, "engine.py")], input=json.dumps(req), capture_output=True, text=True, timeout=120)
    return json.loads(p.stdout)


def bars(n=600, seed=1):
    r = np.random.default_rng(seed)
    drift = np.where((np.arange(n) // 150) % 2 == 0, 0.002, -0.002)   # alternating up / down legs
    c = 100 * np.exp(np.cumsum(drift + r.normal(0, 0.006, n)))
    o = np.r_[c[0], c[:-1]]
    h, l = np.maximum(o, c) * (1 + abs(r.normal(0, .002, n))), np.minimum(o, c) * (1 - abs(r.normal(0, .002, n)))
    return [dict(time=1_700_000_000 + i * 3600, open=o[i], high=h[i], low=l[i], close=c[i], volume=1) for i in range(n)]


def test():
    b = bars()
    g = run({"task": "regime", "bars": b})
    assert g["current"] in ("Uptrend", "Downtrend", "Range") and len(g["labels"]) == len(b), g
    assert abs(sum(v["share"] for v in g["stats"].values() if v) - 1) < 0.01
    assert g["stats"]["Uptrend"]["avgReturnPct"] > g["stats"]["Downtrend"]["avgReturnPct"]
    p = run({"task": "patterns", "bars": b})
    assert p["track"]["Doji"]["count"] > 0 and p["similar"]["neighbours"] == 10, p
    # a hand-made bullish engulfing must be found
    e = b[:-2] + [dict(time=b[-3]["time"] + 3600, open=100, high=100.5, low=97.9, close=98, volume=1), dict(time=b[-3]["time"] + 7200, open=97.5, high=101.5, low=97.4, close=101, volume=1)]
    assert any(f["name"] == "Bullish engulfing" and f["time"] == e[-1]["time"] for f in run({"task": "patterns", "bars": e})["found"])
    r = np.random.default_rng(2)
    t = [dict(sym="X", dir="long" if i % 2 else "short", openTime=1_700_000_000 + i * 86400 + (9 if i % 3 else 15) * 3600, closeTime=1_700_000_000 + i * 86400 + 11 * 3600, net=float(r.normal(-5 if i % 3 == 0 else 8, 3)), status="closed", setup="A" if i % 3 else "B", mistakes=["fomo"] if i % 3 == 0 else []) for i in range(60)]
    j = run({"task": "journal", "trades": t})
    assert j["trades"] == 60 and j["bySetup"][0]["name"] == "B" and j["byMistake"][0]["name"] == "fomo" and "rules" in j, j
    assert "error" in run({"task": "regime", "bars": b[:50]}) and "error" in run({"task": "nope"})
    print("ok")


test()
