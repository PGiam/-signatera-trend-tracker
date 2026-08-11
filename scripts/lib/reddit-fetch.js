// Reddit's script-app registration (the client_credentials OAuth flow this
// project originally used) now requires a manual approval process gated on
// "a valid moderation use case" — not a fit for a market-research bot, and
// not self-serve. This hits Reddit's public, unauthenticated .json endpoints
// instead (same data, no login), which is why every call needs a real
// User-Agent — generic ones get blocked — and generous backoff, since
// unauthenticated traffic is rate-limited more aggressively than OAuth was.

export async function redditPublicFetch(path, params = {}) {
  const userAgent = process.env.REDDIT_USER_AGENT;
  if (!userAgent) {
    throw new Error('REDDIT_USER_AGENT must be set');
  }

  const url = new URL(`https://www.reddit.com${path}.json`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent },
    });

    if ((res.status === 429 || res.status === 403) && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** (attempt + 2);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempt += 1;
      continue;
    }

    if (!res.ok) {
      throw new Error(`Reddit fetch error ${res.status} for ${path}: ${await res.text()}`);
    }

    return res.json();
  }
}
