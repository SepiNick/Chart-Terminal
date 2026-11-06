// The list of live data providers the Connections page shows. Pure data, shared by the server and the browser.
// To add a provider: add one object here (a CCXT exchange needs only `ccxt`; a keyed REST API lists its `keys` and a `test` call).
// Prices are deliberately not hard-coded for paid plans: they change, so a plan points at the provider's own pricing page.

export type Category = 'perp' | 'spot' | 'forex' | 'stocks' | 'futures' | 'market';
export interface KeyField { name: string; label: string; secret?: boolean; optional?: boolean }
/** A request the server makes to check a key. `{name}` is replaced by the (URL-encoded) key field of that name. */
export interface KeyTest { url: string; headers?: Record<string, string>; badBody?: string }
export interface Plan { name: string; price: string; note?: string }
export interface Provider {
  id: string; name: string; category: Category;
  /** Served through CCXT: live candles / trades with no key, perpetuals included. */
  ccxt?: string;
  /** The app can stream this provider live today. Others store the key and are marked "adapter coming". */
  live: boolean;
  free: boolean;
  keys?: KeyField[]; test?: KeyTest;
  plans: Plan[];
  /** Sign-up / pricing page. A referral link from the server's referrals.json replaces it. */
  site: string;
  about: string;
}

const perp = (id: string, name: string, ccxt: string, site: string, about = 'Perpetual futures, live candles and trades. No key needed for market data.'): Provider =>
  ({ id, name, category: 'perp', ccxt, live: true, free: true, plans: [{ name: 'Market data', price: 'Free' }], site, about });
const spot = (id: string, name: string, ccxt: string, site: string): Provider =>
  ({ id, name, category: 'spot', ccxt, live: true, free: true, plans: [{ name: 'Market data', price: 'Free' }], site, about: 'Spot markets, live candles and trades. No key needed for market data.' });

export const CATALOG: Provider[] = [
  // ----- crypto perpetuals (CCXT, free, live) -----
  perp('binanceusdm', 'Binance USD-M Futures', 'binanceusdm', 'https://www.binance.com/en/futures'),
  perp('binancecoinm', 'Binance COIN-M Futures', 'binancecoinm', 'https://www.binance.com/en/delivery'),
  perp('bybit', 'Bybit Perpetuals', 'bybit', 'https://www.bybit.com/'),
  perp('okx', 'OKX Perpetuals', 'okx', 'https://www.okx.com/'),
  perp('bitget', 'Bitget Futures', 'bitget', 'https://www.bitget.com/'),
  perp('gate', 'Gate Futures', 'gate', 'https://www.gate.io/'),
  perp('kucoinfutures', 'KuCoin Futures', 'kucoinfutures', 'https://www.kucoin.com/futures'),
  perp('mexc', 'MEXC Futures', 'mexc', 'https://www.mexc.com/'),
  perp('htx', 'HTX Futures', 'htx', 'https://www.htx.com/'),
  perp('bingx', 'BingX Perpetuals', 'bingx', 'https://bingx.com/'),
  perp('phemex', 'Phemex Perpetuals', 'phemex', 'https://phemex.com/'),
  perp('deribit', 'Deribit', 'deribit', 'https://www.deribit.com/'),
  perp('krakenfutures', 'Kraken Futures', 'krakenfutures', 'https://futures.kraken.com/'),
  perp('blofin', 'BloFin Futures', 'blofin', 'https://blofin.com/'),
  perp('deepcoin', 'Deepcoin Futures', 'deepcoin', 'https://www.deepcoin.com/'),
  perp('hyperliquid', 'Hyperliquid (on-chain perps)', 'hyperliquid', 'https://hyperliquid.xyz/', 'On-chain perpetuals. Market data needs no wallet or key.'),
  perp('dydx', 'dYdX (on-chain perps)', 'dydx', 'https://dydx.trade/', 'On-chain perpetuals. Market data needs no wallet or key.'),
  perp('woo', 'WOO X Perpetuals', 'woo', 'https://x.woo.org/'),
  perp('aster', 'Aster (on-chain perps)', 'aster', 'https://www.asterdex.com/'),
  perp('paradex', 'Paradex (on-chain perps)', 'paradex', 'https://www.paradex.trade/'),
  perp('lighter', 'Lighter (on-chain perps)', 'lighter', 'https://lighter.xyz/'),
  perp('backpack', 'Backpack Exchange', 'backpack', 'https://backpack.exchange/'),
  perp('coinbaseinternational', 'Coinbase International (perps)', 'coinbaseinternational', 'https://international.coinbase.com/'),
  // ----- crypto spot (CCXT, free, live) -----
  spot('binance', 'Binance Spot', 'binance', 'https://www.binance.com/'),
  spot('coinbase', 'Coinbase', 'coinbase', 'https://www.coinbase.com/'),
  spot('kraken', 'Kraken', 'kraken', 'https://www.kraken.com/'),
  spot('kucoin', 'KuCoin Spot', 'kucoin', 'https://www.kucoin.com/'),
  spot('bitfinex', 'Bitfinex', 'bitfinex', 'https://www.bitfinex.com/'),
  spot('whitebit', 'WhiteBIT', 'whitebit', 'https://whitebit.com/'),
  spot('cryptocom', 'Crypto.com', 'cryptocom', 'https://crypto.com/exchange'),
  // ----- forex -----
  {
    id: 'oanda', name: 'OANDA (forex, metals, CFDs)', category: 'forex', live: true, free: true,
    keys: [{ name: 'apiKey', label: 'API token', secret: true }, { name: 'env', label: 'Account type: practice (default) or live', optional: true }],
    test: { url: 'https://api-fxpractice.oanda.com/v3/accounts', headers: { Authorization: 'Bearer {apiKey}' } },
    plans: [{ name: 'Practice (demo) account', price: 'Free', note: 'Streaming prices; an API token comes with the account' }, { name: 'Live account', price: 'Funded account', note: 'Same API, live prices' }],
    site: 'https://www.oanda.com/', about: 'Streaming forex prices over a REST + stream API. Use a practice token to start.',
  },
  {
    id: 'mt5', name: 'MetaTrader 5 (your broker, local bridge)', category: 'forex', live: true, free: true,
    plans: [{ name: 'Local MT5 terminal', price: 'Free', note: 'Any broker you already use in MT5' }],
    site: 'https://www.metatrader5.com/', about: 'Uses the MetaTrader 5 terminal on this computer, so it works with whichever broker it is logged into.',
  },
  {
    id: 'dukascopy', name: 'Dukascopy (free tick history)', category: 'forex', live: false, free: true,
    plans: [{ name: 'Historical ticks', price: 'Free' }], site: 'https://www.dukascopy.com/swiss/english/marketwatch/historical/',
    about: 'Free forex and metals tick history. Adapter planned.',
  },
  // ----- stocks -----
  {
    id: 'alpaca', name: 'Alpaca (US stocks)', category: 'stocks', live: true, free: true,
    keys: [{ name: 'apiKey', label: 'Key ID' }, { name: 'secret', label: 'Secret key', secret: true }, { name: 'env', label: 'Account type: paper (default) or live', optional: true }],
    test: { url: 'https://data.alpaca.markets/v2/stocks/AAPL/trades/latest?feed=iex', headers: { 'APCA-API-KEY-ID': '{apiKey}', 'APCA-API-SECRET-KEY': '{secret}' } },
    plans: [{ name: 'Basic', price: 'Free', note: 'Real-time from IEX only' }, { name: 'Algo Trader Plus', price: 'See pricing', note: 'Full US market (SIP) real-time' }],
    site: 'https://alpaca.markets/data', about: 'US stocks and ETFs, real-time over WebSocket.',
  },
  {
    id: 'polygon', name: 'Polygon.io (US stocks, options, forex, crypto)', category: 'stocks', live: false, free: true,
    keys: [{ name: 'apiKey', label: 'API key', secret: true }],
    test: { url: 'https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apiKey={apiKey}' },
    plans: [{ name: 'Basic', price: 'Free', note: 'Delayed, limited calls per minute' }, { name: 'Paid tiers', price: 'See pricing', note: 'Real-time and tick data' }],
    site: 'https://polygon.io/pricing', about: 'One API for US stocks, options, forex and crypto.',
  },
  {
    id: 'finnhub', name: 'Finnhub (stocks, forex, crypto)', category: 'stocks', live: false, free: true,
    keys: [{ name: 'apiKey', label: 'API key', secret: true }],
    test: { url: 'https://finnhub.io/api/v1/quote?symbol=AAPL&token={apiKey}' },
    plans: [{ name: 'Free', price: 'Free', note: 'Rate-limited, includes a WebSocket' }, { name: 'Paid', price: 'See pricing' }],
    site: 'https://finnhub.io/pricing', about: 'Global stock quotes, forex and crypto with a free tier.',
  },
  {
    id: 'twelvedata', name: 'Twelve Data (stocks, forex, crypto, indices)', category: 'stocks', live: false, free: true,
    keys: [{ name: 'apiKey', label: 'API key', secret: true }],
    test: { url: 'https://api.twelvedata.com/price?symbol=AAPL&apikey={apiKey}', badBody: '"status":"error"' },
    plans: [{ name: 'Basic', price: 'Free', note: 'Limited credits per day' }, { name: 'Paid', price: 'See pricing', note: 'WebSocket streaming' }],
    site: 'https://twelvedata.com/pricing', about: 'Stocks, forex, crypto and indices worldwide.',
  },
  {
    id: 'tiingo', name: 'Tiingo (stocks, IEX real-time, crypto, forex)', category: 'stocks', live: false, free: true,
    keys: [{ name: 'apiKey', label: 'API token', secret: true }],
    test: { url: 'https://api.tiingo.com/api/test?token={apiKey}' },
    plans: [{ name: 'Starter', price: 'Free' }, { name: 'Paid', price: 'See pricing' }],
    site: 'https://www.tiingo.com/about/pricing', about: 'End-of-day and IEX real-time prices.',
  },
  // ----- futures -----
  {
    id: 'databento', name: 'Databento (CME, ICE and more futures)', category: 'futures', live: false, free: false,
    keys: [{ name: 'apiKey', label: 'API key', secret: true }],
    plans: [{ name: 'Pay as you go', price: 'See pricing', note: 'Usage-based; exchange licence fees may apply for live data' }],
    site: 'https://databento.com/pricing', about: 'Institutional-grade futures data (CME Globex, ICE). Live data needs the exchange licence.',
  },
  // ----- market cap / derivatives data -----
  {
    id: 'coingecko', name: 'CoinGecko (market caps, dominance)', category: 'market', live: true, free: true,
    keys: [{ name: 'apiKey', label: 'Demo / Pro API key (optional)', secret: true }],
    test: { url: 'https://api.coingecko.com/api/v3/ping?x_cg_demo_api_key={apiKey}' },
    plans: [{ name: 'Public', price: 'Free', note: 'Used now for dominance and TOTAL' }, { name: 'Demo key', price: 'Free', note: 'Higher rate limit' }, { name: 'Pro', price: 'See pricing' }],
    site: 'https://www.coingecko.com/en/api/pricing', about: 'Market caps behind the dominance and TOTAL symbols.',
  },
  {
    id: 'coinmarketcap', name: 'CoinMarketCap (market caps)', category: 'market', live: false, free: true,
    keys: [{ name: 'apiKey', label: 'API key', secret: true }],
    test: { url: 'https://pro-api.coinmarketcap.com/v1/key/info', headers: { 'X-CMC_PRO_API_KEY': '{apiKey}' } },
    plans: [{ name: 'Basic', price: 'Free' }, { name: 'Paid', price: 'See pricing' }], site: 'https://coinmarketcap.com/api/pricing/',
    about: 'Alternative market-cap source.',
  },
  {
    id: 'coinglass', name: 'Coinglass (liquidations, open interest, funding)', category: 'market', live: false, free: false,
    keys: [{ name: 'apiKey', label: 'API key', secret: true }],
    plans: [{ name: 'Paid plans', price: 'See pricing' }], site: 'https://www.coinglass.com/pricing', about: 'Aggregated derivatives data across exchanges.',
  },
];

export const CATEGORY_NAMES: Record<Category, string> = { perp: 'Crypto perpetuals', spot: 'Crypto spot', forex: 'Forex & CFDs', stocks: 'Stocks & ETFs', futures: 'Futures', market: 'Market caps & derivatives data' };
export const providerById = (id: string) => CATALOG.find(p => p.id === id);
