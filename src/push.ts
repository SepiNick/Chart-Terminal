// [agent: lan] Web Push on this device (service worker + subscription). Contract stub — docs/phase5-contracts.md §8.
export type PushState = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on';
/** Whether push can work here and is enabled on this device. */
export async function pushState(): Promise<PushState> { return 'unsupported' }
/** Ask for permission, subscribe and register the subscription with the server. */
export async function enablePush(): Promise<void> { throw Error('Push is not implemented yet') }
export async function disablePush(): Promise<void> {}
/** Register /sw.js (safe to call more than once). */
export async function registerServiceWorker(): Promise<void> {}
