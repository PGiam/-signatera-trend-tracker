import { createClient } from '@supabase/supabase-js';

// Server-side only — service-role key must never reach the browser bundle.
// This project is a single-user personal dashboard (Philip's own account),
// so the dashboard pages read through this client rather than per-request
// RLS-scoped clients.
export function getServiceClient() {
  return createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function getAuthClient(cookies) {
  return createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: cookies?.get('sb-access-token')?.value
        ? { Authorization: `Bearer ${cookies.get('sb-access-token').value}` }
        : {},
    },
  });
}
