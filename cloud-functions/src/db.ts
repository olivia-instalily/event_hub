// Shared Supabase client for all functions.
// Points at the internal Caddy port (9000) which proxies /rest/v1/* → PostgREST without
// overriding the Authorization header — so the service_role JWT passes through as-is.
import { createClient } from '@supabase/supabase-js';

export function getServiceClient() {
  const url = process.env.SUPABASE_URL!;          // http://localhost:9000
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}
