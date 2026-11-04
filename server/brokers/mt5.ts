// MetaTrader 5 demo account through the local bridge (mt5bridge/bridge.py). The bridge refuses every trading call
// unless the terminal is on a DEMO netting account; this adapter checks the same before each balance read, so the
// guardian's "testnet" and "key" items fail on a real account. Quantities are units (lots × contract size).
import type { Balance, BrokerFill, BrokerOrder, BrokerPosition } from '../../src/broker/types.ts';
import type { Adapter, Native } from './adapter.ts';
import { MT5_URL, mt5Call } from '../mt5.ts';

const bare = (sym: string) => sym.replace(/^[A-Z0-9]+:/, '');

export function mt5Adapter(token: string): Adapter {
  const call = <T>(path: string, body?: object) => mt5Call<T>(path, token, body);
  return {
    hosts: [`${new URL(MT5_URL).host} (MetaTrader 5 bridge: demo accounts only)`],
    native: new Set(['stop', 'stop_limit']),
    canEdit: false,
    upnlInBalance: true,   // the bridge reports equity
    async balances() {
      const a = await call<{ demo: boolean; netting: boolean }>('/account');
      if (!a.demo) throw Error('MetaTrader 5 is logged in to a REAL account: refused (demo accounts only)');
      if (!a.netting) throw Error('Use a netting demo account in MetaTrader 5 (hedging is not supported)');
      return call<Balance[]>('/balances');
    },
    positions: () => call<BrokerPosition[]>('/positions'),
    openOrders: () => call<BrokerOrder[]>('/orders'),
    order: id => call<BrokerOrder>(`/order?id=${encodeURIComponent(id)}`),
    fills: () => call<BrokerFill[]>('/fills'),
    price: async sym => (await mt5Call<{ last: number }>(`/tick?symbol=${encodeURIComponent(bare(sym))}`)).last,
    place: (o: Native) => call<BrokerOrder>('/order', { ...o, sym: bare(o.sym) }),
    async cancel(id) { await call('/cancel', { id }) },
    canWithdraw: async () => false,   // the MT5 Python API cannot move money
    close() {},
  };
}
