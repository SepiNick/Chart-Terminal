// Saved provider keys (encrypted in the secrets table). Kept apart from providers.ts so data sources can read them without loading the routes.
import { providerById } from '../src/providers/catalog.ts';
import { secretGet } from './core/secrets.ts';

export const keyName = (id: string, field: string) => `provider:${id}:${field}`;

/** The saved key fields of a provider, or null when a required one is missing. Optional fields are left out when unset. */
export function providerKeys(id: string): Record<string, string> | null {
  const p = providerById(id); if (!p?.keys) return null;
  const out: Record<string, string> = {};
  for (const k of p.keys) { const v = secretGet(keyName(id, k.name)); if (v != null) out[k.name] = v; else if (!k.optional) return null }
  return out;
}
