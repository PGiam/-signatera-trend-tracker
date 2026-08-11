import { createServerClient } from '@supabase/ssr';

// One client per request, backed by Astro's cookie API — this is what
// authenticates the current visitor (as opposed to getServiceClient in
// supabase.js, which is the server-side-only service-role client used for
// all data reads/writes regardless of who's signed in).
export function getServerSupabase({ cookies, request }) {
  return createServerClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.headers
          .get('cookie')
          ?.split(';')
          .filter(Boolean)
          .map((pair) => {
            const [name, ...rest] = pair.trim().split('=');
            return { name, value: rest.join('=') };
          }) ?? [];
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, { ...options, path: '/' });
        });
      },
    },
  });
}
