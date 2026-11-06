// Live data sources that need the owner's own keys. Private servers only: a public server never loads them or the secrets store.
import { isPublic } from '../core/mode.ts';
import type { IranSource } from '../iran/index.ts';

export const LIVE: Record<string, IranSource> = isPublic ? {} : (await import('./sources.ts')).LIVE;
