import { createHash } from 'node:crypto';

export const prerender = false;

export async function POST({ request, cookies }) {
  const { passcode } = await request.json();
  const expected = import.meta.env.DASHBOARD_PASSCODE || '';

  if (!passcode || !expected || passcode !== expected) {
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }

  cookies.set('dashboard_access', createHash('sha256').update(expected).digest('hex'), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
