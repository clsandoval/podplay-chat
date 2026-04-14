import { Hono } from 'hono';
import type { AuthEnv } from '../middleware/auth.js';

const REPO = 'clsandoval/podplay-data';
const CACHE_TTL_MS = 60_000; // 60 seconds

const cache = new Map<string, { data: any; expiresAt: number }>();

const github = new Hono<AuthEnv>();

github.get('/:path{.+}', async (c) => {
  const path = c.req.param('path');
  const cacheKey = path;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json(cached.data);
  }

  // Fetch from GitHub
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}?ref=main`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'podplay-chat-proxy',
      },
    },
  );

  if (!res.ok) {
    return c.json({ error: `GitHub API error: ${res.status}` }, res.status as any);
  }

  const data = await res.json();

  // Cache the response
  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });

  return c.json(data);
});

export { github };
