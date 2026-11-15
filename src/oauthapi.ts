// The only place that knows the server's OAuth / identity routes and answer shapes (docs/research/oauth-sync-design.md §1.2).
// If the server agent chose another shape, change it here.
import { api } from './sync.ts';
import { authPost } from './login.ts';

export type Provider = 'google' | 'apple' | 'telegram';
export type Intent = 'login' | 'link' | 'reauth';
export type User = { name: string; role?: string; mustChange?: boolean; id?: string | number };
export type ExchangeResult = { user?: User } | { signup: true; ticket: string; hint?: string } | { linked: string };
export const oauthStart = (b: { provider: Provider; intent: Intent; challenge: string; ret: 'web' | 'app'; password?: string }) => api<{ url: string }>('/api/auth/oauth/start', { body: b });
export const oauthExchange = (code: string, verifier: string) => authPost<ExchangeResult>('/api/auth/oauth/exchange', { code, verifier });
export const oauthSignup = (b: { ticket: string; verifier: string; name: string; invite?: string }) => authPost<{ user?: User; recoveryCodes?: string[] }>('/api/auth/oauth/signup', b);
export interface Identity { provider: Provider; email?: string | null; relay?: boolean | number; created?: number; lastLogin?: number }
export async function identities(): Promise<{ list: Identity[]; hasPassword: boolean }> {
  const j = await api<Identity[] | { identities?: Identity[]; hasPassword?: boolean }>('/api/auth/identities');
  return Array.isArray(j) ? { list: j, hasPassword: true } : { list: j.identities ?? [], hasPassword: j.hasPassword !== false };
}
export const unlinkIdentity = (p: Provider, password?: string) => api(`/api/auth/identities/${p}`, { method: 'DELETE', body: password ? { password } : {} });
