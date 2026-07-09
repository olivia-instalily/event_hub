import { createClient } from '@supabase/supabase-js';

// Two modes:
//  • Local dev: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY point straight at the local stack.
//  • Prod (reverse-proxy behind IAP): leave both UNSET. The app then talks to its OWN origin,
//    where the Caddy reverse-proxy (see Dockerfile / Caddyfile) forwards /rest, /storage,
//    /functions to Supabase and injects the real anon key server-side — so the key never ships
//    in the bundle and the browser never hits Supabase directly.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const resolvedUrl = url || (typeof window !== 'undefined' ? window.location.origin : undefined);
const resolvedKey = anonKey || 'proxied'; // placeholder; the reverse-proxy overwrites apikey/Authorization

if (!resolvedUrl) {
  throw new Error(
    'Missing VITE_SUPABASE_URL. For local dev, run `supabase start` and copy the values into ' +
      '.env.local (see .env.local.example). In prod, serve behind the reverse-proxy so the app ' +
      'uses its own origin.',
  );
}

export const supabase = createClient(resolvedUrl, resolvedKey);

// True in the deployed (reverse-proxy) mode: no VITE_SUPABASE_URL, so we're behind Caddy on GCP,
// which has PostgREST + functions but NO Supabase Storage. Storage-dependent calls route through
// the GCS-backed storage-upload/storage-sign cloud functions instead. Local dev keeps using
// Supabase Storage directly.
export const proxiedBackend = !url;
