import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { authMiddleware, type AuthEnv } from './middleware/auth.js';
import { sessions } from './routes/sessions.js';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

const api = new Hono<AuthEnv>();
api.use('*', authMiddleware);

api.get('/me', (c) => {
  return c.json({ userId: c.get('userId'), email: c.get('userEmail') });
});

api.route('/sessions', sessions);

app.route('/api', api);

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, () => {
  console.log(`Proxy server running on port ${port}`);
});

export default app;
