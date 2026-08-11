import { getServerSupabase } from '../../../lib/supabase-server.js';

export const prerender = false;

export async function GET(context) {
  const code = context.url.searchParams.get('code');
  if (code) {
    const supabase = getServerSupabase(context);
    await supabase.auth.exchangeCodeForSession(code);
  }
  return context.redirect('/');
}
