import { getServerSupabase } from '../../../lib/supabase-server.js';

export const prerender = false;

export async function POST(context) {
  const supabase = getServerSupabase(context);
  await supabase.auth.signOut();
  return context.redirect('/login');
}
