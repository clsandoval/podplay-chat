import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { authMiddleware, type AuthEnv } from './middleware/auth.js';
import { sessions } from './routes/sessions.js';
import { stream } from './routes/stream.js';
import { github } from './routes/github.js';
import * as anthropic from './lib/anthropic.js';
import { supabase } from './lib/supabase.js';
import { sessionManager } from './lib/session-manager.js';

const app = new Hono();

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: err.message }, 500);
});

app.get('/health', (c) => c.json({ status: 'ok' }));

app.use('/api/*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

const api = new Hono<AuthEnv>();
api.use('*', authMiddleware);

api.get('/me', (c) => {
  return c.json({ userId: c.get('userId'), email: c.get('userEmail') });
});

api.route('/sessions', sessions);
api.route('/sessions', stream);
api.route('/github', github);

app.route('/api', api);

// Archive sessions idle for > 1 hour
async function cleanupIdleSessions() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Catch both: sessions with old last_message_at AND sessions that never got a message
  const { data: stale } = await supabase
    .from('chat_sessions')
    .select('session_id')
    .eq('status', 'active')
    .or(`last_message_at.lt.${oneHourAgo},and(last_message_at.is.null,created_at.lt.${oneHourAgo})`);

  if (!stale?.length) return;

  for (const row of stale) {
    try {
      // Disconnect the in-memory SSE connection first
      sessionManager.disconnect(row.session_id);
      await anthropic.archiveSession(row.session_id);
      await supabase
        .from('chat_sessions')
        .update({ status: 'archived' })
        .eq('session_id', row.session_id);
    } catch (err) {
      console.error(`Failed to archive session ${row.session_id}:`, err);
    }
  }

  if (stale.length > 0) {
    console.log(`Archived ${stale.length} idle sessions`);
  }
}

// Run every 10 minutes
setInterval(cleanupIdleSessions, 10 * 60 * 1000);

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, () => {
  console.log(`Proxy server running on port ${port}`);
});

export default app;
