// The live sources that read the owner's saved keys. Loaded only by a private server (see index.ts): it pulls in the secrets store.
import type { IranSource } from '../iran/index.ts';
import { OANDA } from './oanda.ts';
import { ALPACA } from './alpaca.ts';

export const LIVE: Record<string, IranSource> = Object.fromEntries([OANDA, ALPACA].map(s => [s.id, s]));
