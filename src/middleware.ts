import { defineMiddleware } from 'astro:middleware';
import { getServerSupabase } from './lib/supabase-server.js';

// This is a single-user personal dashboard: the allowlisted email is the
// only account permitted in, regardless of what Supabase Auth itself would
// allow to sign up.
const PUBLIC_PATHS = ['/login', '/api/auth/send-otp', '/api/auth/callback'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (PUBLIC_PATHS.includes(pathname)) {
    return next();
  }

  const supabase = getServerSupabase(context);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allowedEmail = (import.meta.env.ALLOWED_EMAIL || '').toLowerCase();
  if (!user || user.email?.toLowerCase() !== allowedEmail) {
    return context.redirect('/login');
  }

  context.locals.user = user;
  return next();
});
