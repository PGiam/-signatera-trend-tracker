import { getServerSupabase } from '../../../lib/supabase-server.js';

export const prerender = false;

export async function POST(context) {
  const { request, url } = context;
  const { email } = await request.json();

  const allowedEmail = (import.meta.env.ALLOWED_EMAIL || '').toLowerCase();
  if (!email || email.toLowerCase() !== allowedEmail) {
    // Same response whether the email is wrong or missing — don't reveal
    // which emails are/aren't allowed.
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const supabase = getServerSupabase(context);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${url.origin}/api/auth/callback` },
  });
  // Still respond ok:true either way — this endpoint deliberately never
  // reveals to the client whether sending failed, only logs it server-side.
  if (error) console.error('signInWithOtp failed:', error.status, error.message);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
