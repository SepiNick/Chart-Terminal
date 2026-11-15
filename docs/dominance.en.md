[English](dominance.en.md) · [فارسی](dominance.md)

# Dominance and total crypto market cap

These symbols can be searched, drawn, added to the watchlist, used in Pine, alerts and comparison like any other symbol. The exchange prefix is `CRYPTOCAP:` (as in TradingView).

| Symbol | Meaning |
|---|---|
| `CRYPTOCAP:BTC.D` `ETH.D` `USDT.D` `USDC.D` | each coin's share of the whole market, in percent |
| `CRYPTOCAP:OTHERS.D` | the share of all coins except the top 10 |
| `CRYPTOCAP:STABLE.D` | the share of all stablecoins together |
| `CRYPTOCAP:TOTAL` `TOTAL2` `TOTAL3` | total market cap; without BTC; without BTC and ETH (dollars) |

Typing just `BTC.D` or `TOTAL` in the symbol box also reaches these symbols. In search they appear under the "Crypto market" group and also work in standalone mode (no server). Dominance defaults to a line chart with a percentage axis.

## Data source (no key)

No free keyless source provides dominance history. So:

1. **CoinGecko** (`api.coingecko.com`, fixed host): `/global` for the total, `/coins/markets` for the market cap and supply of the top 100 coins, `/coins/{id}/market_chart` for the real market-cap history of USDT and USDC (about a year). A 2.5-second gap between requests, a cache (2 to 5 minutes, the stablecoin chart 6 hours), and back-off after a 429/403 (per Retry-After, or 30 seconds doubling up to 15 minutes).
2. **Binance** (the candles the app already has): `<COIN>USDT` for the top 30 non-stable coins.
3. **Local recording** (private server only): every 5 minutes a snapshot of the components (total, BTC, ETH, USDT, USDC, stables, top 10) in the `dom_snap` database table, at most 150,000 rows (about 1.4 years). From the day recording starts the series is exact.

## Estimates and limits

Before recording starts, every candle is an **estimate**: "market cap = Binance close price × current circulating supply". The symbol description says so too ("estimate from price × current supply"). Every output candle has an `approx` field (true = estimate), and the rows of `/api/markets?exchange=cryptocap` have `approxUntil` (recording start time, seconds) and `note` fields.

- Past supply differs from today's (issuance, burns). The further back, the larger the error.
- Coins with no Binance pair, or whose price does not match CoinGecko (e.g. XMR), stay fixed at the current value. Wrapped tokens (WBTC, stETH …) follow the base coin's candle.
- The market share outside the top 100 coins (the tail) moves with the altcoin basket; this is an assumption. The whole series is scaled so the last candle equals `/global`, because the sum of CoinGecko's list is sometimes larger than the total (wrapped tokens).
- The value of USDT and USDC comes from `market_chart` (real, about 365 days); older than that stays fixed.
- Top 10 = the **current** top 10 (including stablecoins) for the whole history.
- Less than 1 minute is not supported. The ticker/daily change in the watchlist comes from the live candle.

**Seamless:** when recording starts, the estimated part before it is multiplied per component by a factor (recorded value ÷ estimate at the first snapshot) so it meets the real value. Recording gaps (the server was off) are filled with the same scaled estimate and carry `approx: true`.

## Public mode

No recorder; fixed hosts only; only the symbols in the table (any other symbol is refused); one cache and one cap shared per process (1,200 candle requests a minute, 400 cache entries). In standalone mode the browser reads directly from Binance and CoinGecko (CoinGecko sends a CORS header) and all candles are estimates.

## Live check

```
npm run check:dominance
npm run check:dominance -- --capture   # raw responses in server/dominance/fixtures/live/
```

If your network or VPN blocks it, it gives a clear message (429 or 403); in that case the last cached version is returned, labelled stale.
