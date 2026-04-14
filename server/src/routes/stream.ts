import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AuthEnv } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { sessionManager } from '../lib/session-manager.js';

const stream = new Hono<AuthEnv>();

stream.get('/:id/stream', async (c) => {
  const sessionId = c.req.param('id');
  const userId = c.get('userId');

  // Verify ownership
  const { data: row } = await supabase
    .from('chat_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!row) return c.json({ error: 'Session not found' }, 404);

  // Ensure session manager has a connection (may already exist from creation)
  if (!sessionManager.isConnected(sessionId)) {
    sessionManager.connect(sessionId);
  }

  return streamSSE(c, async (sseStream) => {
    const { replay, unsubscribe } = sessionManager.subscribe(
      sessionId,
      async (event) => {
        try {
          // IMPORTANT: Anthropic sends all SSE events as `event: message`.
          // We mirror this so the browser's EventSource.onmessage handler
          // receives all events. The actual event type is inside the JSON
          // payload's `type` field (e.g., "agent.message", "session.status_idle").
          await sseStream.writeSSE({
            event: 'message',
            data: JSON.stringify(event),
          });
        } catch {
          // Browser disconnected
          unsubscribe();
        }
      },
    );

    // Replay buffered events first
    for (const event of replay) {
      await sseStream.writeSSE({
        event: 'message',
        data: JSON.stringify(event),
      });
    }

    // Keep the connection open until the browser disconnects
    // The subscriber callback handles new events
    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => {
        unsubscribe();
        resolve();
      });
    });
  });
});

export { stream };
