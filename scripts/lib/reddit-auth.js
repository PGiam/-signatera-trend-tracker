let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * App-only OAuth token via the client_credentials grant. Sufficient for
 * reading public posts/comments/search — no bot account login required.
 */
export async function getRedditAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT;
  if (!clientId || !clientSecret || !userAgent) {
    throw new Error('REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT must be set');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Reddit auth failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  cachedToken = json.access_token;
  cachedTokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
  return cachedToken;
}

export async function redditApiFetch(path, params = {}) {
  const token = await getRedditAccessToken();
  const userAgent = process.env.REDDIT_USER_AGENT;
  const url = new URL(`https://oauth.reddit.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
    });

    if (res.status === 429 && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempt += 1;
      continue;
    }

    if (!res.ok) {
      throw new Error(`Reddit API error ${res.status} for ${path}: ${await res.text()}`);
    }

    return res.json();
  }
}
