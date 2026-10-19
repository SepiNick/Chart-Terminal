// [agent: lan] Web Push on this device (service worker + subscription). docs/phase5-contracts.md §8.
import { api } from './sync.ts';

export type PushState = 'unsupported' | 'insecure' | 'denied' | 'off' | 'on';

// iPhone Safari only exposes PushManager inside the Home Screen app, so a plain tab reports 'unsupported'.
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function subscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Whether push can work here and is enabled on this device. */
export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure';   // plain http on the LAN: service workers are unavailable
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && await subscription() ? 'on' : 'off';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64url.length % 4) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** Ask for permission, subscribe and register the subscription with the server. */
export async function enablePush(): Promise<void> {
  const st = await pushState();
  if (st === 'insecure') throw Error('Notifications need HTTPS — open the app through its https:// address');
  if (st === 'unsupported') throw Error('This browser does not support push notifications (on iPhone: add the app to the Home Screen first)');
  if (await Notification.requestPermission() !== 'granted') throw Error('Notifications are blocked for this site — allow them in the browser settings');
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/api/notify/push/key');
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null }   // server keys changed
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/notify/push/subscribe', { body: { subscription: sub.toJSON(), agent: navigator.userAgent } });
}

export async function disablePush(): Promise<void> {
  if (!window.isSecureContext || !supported()) return;
  const sub = await subscription();
  if (!sub) return;
  await api('/api/notify/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

/** Register /sw.js (safe to call more than once). */
export async function registerServiceWorker(): Promise<void> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
}
