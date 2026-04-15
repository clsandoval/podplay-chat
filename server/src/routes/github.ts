import { Hono } from 'hono';
import type { AuthEnv } from '../middleware/auth.js';

const REPO = 'clsandoval/podplay-data';
const CACHE_TTL_MS = 60_000; // 60 seconds

const cache = new Map<string, { data: any; expiresAt: number }>();

const github = new Hono<AuthEnv>();

const MIME_TYPES: Record<string, string> = {
  yaml: 'text/yaml', yml: 'text/yaml',
  md: 'text/markdown', json: 'application/json',
  csv: 'text/csv', txt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};

github.get('/:path{.+}', async (c) => {
  const path = c.req.param('path');
  const cacheKey = path;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const fileName = path.split('/').pop() || 'download';
    c.header('Content-Type', cached.data.contentType);
    c.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return c.body(cached.data.buffer);
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

  const data: any = await res.json();

  // Decode base64 content and serve as downloadable file
  if (data.content && data.encoding === 'base64') {
    const buffer = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileName = path.split('/').pop() || 'download';

    cache.set(cacheKey, {
      data: { buffer, contentType },
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    c.header('Content-Type', contentType);
    c.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return c.body(buffer);
  }

  return c.json(data);
});

export { github };
