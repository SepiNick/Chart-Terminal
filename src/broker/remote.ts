// Exchange testnet accounts as Brokers (docs/phase6-contracts.md): one RemoteBroker per account from the server,
// talking to /api/broker/:id/… and kept current by the server's `{ type: 'broker', account, state }` pushes.
// Keys never pass through here after the one POST in ui.ts; the server keeps them.
import type { AccountInput, Broker, BrokerAccount, BrokerOrder, BrokerState, GuardianReport, Guard, OrderPatch, OrderReq } from './types.ts';
import { registerBroker, unregisterBroker } from './registry.ts';
import { apiTrade, onServer } from '../sync.ts';

export type Api = typeof apiTrade;
const enc = encodeURIComponent;

export class RemoteBroker implements Broker {
  account: BrokerAccount;
  private st: BrokerState | null = null;
  private subs = new Set<(s: BrokerState) => void>();
  private call: Api;
  constructor(account: BrokerAccount, call: Api = apiTrade) { this.account = account; this.call = call }

  state() { return this.st }
  /** Replace the state; a push older than what we have is ignored (a slow GET must not undo a newer WS update). */
  push(s: BrokerState) {
    if (this.st && s.updated < this.st.updated) return;
    this.st = s; this.subs.forEach(f => f(s));
  }
  onChange(fn: (s: BrokerState) => void) { this.subs.add(fn); return () => { this.subs.delete(fn) } }

  private url(p = '') { return `/api/broker/${enc(this.account.id)}${p}` }
  private async req<T>(path: string, init?: Parameters<Api>[1]): Promise<T> {
    try { return await this.call<T>(this.url(path), init) }
    catch (e) {
      const st = (e as { status?: number }).status;
      // fetch's own TypeError has no status: the server is down or unreachable
      throw Object.assign(Error(st == null ? `${this.account.label}: server not reachable` : `${this.account.label}: ${(e as Error).message}`), { status: st });
    }
  }
  /** Put one order into the local state now, so the UI doesn't wait for the WS push. */
  private merge(o: BrokerOrder | null, drop?: string) {
    if (!this.st) return;
    const orders = this.st.orders.filter(x => x.id !== drop && x.id !== o?.id);
    if (o) orders.push(o);
    this.push({ ...this.st, orders });   // keeps the server's `updated`, so its next push still applies
  }

  async refresh() { const s = await this.req<BrokerState>('/state'); this.push(s); return this.st! }
  async place(o: OrderReq) { if (o.exits) throw new Error('Exit plans run on the paper account for now: on an exchange account use take-profit and stop-loss'); const r = await this.req<BrokerOrder>('/orders', { method: 'POST', body: o }); this.merge(r); return r }
  async cancel(id: string) { await this.req<void>(`/orders/${enc(id)}`, { method: 'DELETE' }); this.merge(null, id) }
  async modify(id: string, patch: OrderPatch) { const r = await this.req<BrokerOrder>(`/orders/${enc(id)}`, { method: 'PATCH', body: patch }); this.merge(r); return r }
  async closePosition(sym: string) { await this.req<void>('/close', { method: 'POST', body: { sym } }); this.refresh().catch(() => {}) }
}

// ---------- the account list ----------
const remotes = new Map<string, RemoteBroker>();
let wired = false;

/** Make the registry match the server's list: new accounts registered, deleted ones unregistered, the rest updated. */
export function syncAccounts(list: BrokerAccount[], call: Api = apiTrade) {
  if (!wired) {
    wired = true;
    onServer('broker', m => remotes.get(String(m.account))?.push(m.state as BrokerState));
    onServer('broker.accounts', m => syncAccounts(m.accounts as BrokerAccount[], call));   // status changes (tripped, error)
  }
  for (const id of [...remotes.keys()]) if (!list.some(a => a.id === id)) { remotes.delete(id); unregisterBroker(id) }
  for (const a of list) {
    let b = remotes.get(a.id);
    if (b) b.account = a;
    else { remotes.set(a.id, (b = new RemoteBroker(a, call))); b.refresh().catch(() => {}) }   // state errors show in the panel
    registerBroker(b);   // also tells listeners an account changed (status, label, guard)
  }
}
/** Load the exchange accounts from the server (server mode only). */
export async function loadAccounts(call: Api = apiTrade) { const list = await call<BrokerAccount[]>('/api/broker/accounts'); syncAccounts(list, call); return list }
export const remoteAccounts = () => [...remotes.values()].map(b => b.account);

// ---------- account management (ui.ts) ----------
/** The keys go to the server in this one request and are never sent back. */
export async function addAccount(input: AccountInput, call: Api = apiTrade) {
  const a = await call<BrokerAccount>('/api/broker/accounts', { method: 'POST', body: input });
  await loadAccounts(call).catch(() => {});
  return a;
}
export async function deleteAccount(id: string, call: Api = apiTrade) {
  await call<void>(`/api/broker/accounts/${enc(id)}`, { method: 'DELETE' });
  if (remotes.delete(id)) unregisterBroker(id);
}
export async function saveAccount(id: string, patch: { label?: string; guard?: Partial<Guard> }, call: Api = apiTrade) {
  const a = await call<BrokerAccount>(`/api/broker/accounts/${enc(id)}`, { method: 'PUT', body: patch });
  const b = remotes.get(id); if (b) { b.account = a; registerBroker(b) }
  return a;
}
export async function checkAccount(id: string, call: Api = apiTrade) {
  const r = await call<GuardianReport>(`/api/broker/accounts/${enc(id)}/check`, { method: 'POST' });
  await loadAccounts(call).catch(() => {});   // the check may have activated it
  return r;
}

/** When a tripped account can trade again: the next UTC midnight. */
export const tripReset = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) };
