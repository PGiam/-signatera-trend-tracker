import { defineMiddleware } from 'astro:middleware';
import { createHash } from 'node:crypto';

// Low-stakes shared-passcode gate — this dashboard is meant to be shareable
// with a handful of people via one passcode, not locked to a single email
// account. Anyone holding the cookie (or the passcode) can view it.
const PUBLIC_PATHS = ['/login', '/api/auth/verify-passcode'];

function expectedCookieValue() {
  return createHash('sha256').update(import.meta.env.DASHBOARD_PASSCODE || '').digest('hex');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (PUBLIC_PATHS.includes(pathname)) {
    return next();
  }

  const cookie = context.cookies.get('dashboard_access')?.value;
  if (!cookie || cookie !== expectedCookieValue()) {
    return context.redirect('/login');
  }

  return next();
});
