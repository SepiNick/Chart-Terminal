// Which brokers exist in this browser and which one the ticket, chart lines and DOM trade on (docs/phase6-contracts.md).
// The paper broker is registered by main.ts; exchange accounts by src/broker/remote.ts.
import type { Broker } from './types.ts';
import { store } from '../store.ts';

const brokers = new Map<string, Broker>();
const subs = new Set<() => void>();
let activeId = store.get<string>('brokerActive', 'paper');
const changed = () => subs.forEach(f => f());

export function registerBroker(b: Broker) { brokers.set(b.account.id, b); changed() }
export function unregisterBroker(id: string) { if (brokers.delete(id)) { if (activeId === id) setActiveBroker('paper'); changed() } }
export const allBrokers = () => [...brokers.values()];
export const brokerById = (id: string) => brokers.get(id);
/** The account the user trades on now; falls back to paper. */
export const activeBroker = (): Broker | undefined => brokers.get(activeId) ?? brokers.get('paper');
export function setActiveBroker(id: string) { activeId = id; store.set('brokerActive', id); changed() }
/** Called when brokers are added/removed or the active one changes. */
export function onBrokers(fn: () => void): () => void { subs.add(fn); return () => subs.delete(fn) }
