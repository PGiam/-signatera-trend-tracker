export const prerender = false;

export async function POST({ cookies, redirect }) {
  cookies.delete('dashboard_access', { path: '/' });
  return redirect('/login');
}
