// CCXT is ~100 MB of RSS and ~1 s of CPU to load, so nothing loads it at startup: the first exchange call does.
// `exchanges.json` is the static id list (checked against CCXT by server.test.ts) so listing/validating ids stays free.
import { createRequire } from 'node:module';
import type ccxtNs from 'ccxt';
import ids from './exchanges.json' with { type: 'json' };

let lib: typeof ccxtNs | undefined;
/** The CCXT namespace, loaded on first use (the CJS and ESM builds export different shapes). */
export const ccxtLib = (): typeof ccxtNs => lib ??= (m => (m.exchanges ? m : (m as unknown as { default: typeof ccxtNs }).default))(createRequire(import.meta.url)('ccxt') as typeof ccxtNs);
export const EXCHANGE_IDS: readonly string[] = ids;
export const ccxtLoaded = () => !!lib;
